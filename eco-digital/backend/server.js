require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('Falta JWT_SECRET en el archivo .env'); process.exit(1); }

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'eco_digital',
  waitForConnections: true,
  connectionLimit: 10
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(500).json({ error: 'Error del servidor. Intenta de nuevo.' });
});

function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Tu sesión venció. Inicia sesión de nuevo.' });
  }
}

function token(u) {
  const t = jwt.sign({ id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol }, SECRET, { expiresIn: '2h' });
  return { token: t, usuario: { nombre: u.nombre, correo: u.correo, rol: u.rol } };
}

// ---- Autenticación ----
app.post('/api/auth/registro', wrap(async (req, res) => {
  const { nombre, correo, password } = req.body || {};
  if (!nombre || nombre.trim().length < 3) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo || '')) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres.' });
  const [ya] = await pool.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
  if (ya.length) return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query('INSERT INTO usuarios (nombre, correo, password_hash) VALUES (?,?,?)', [nombre.trim(), correo, hash]);
  res.json(token({ id: r.insertId, nombre: nombre.trim(), correo, rol: 'usuario' }));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { correo, password } = req.body || {};
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ?', [correo || '']);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  res.json(token(u));
}));

// ---- Documentos ----
app.get('/api/documentos', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, titulo, descripcion, contenido FROM documentos ORDER BY id');
  res.json(rows);
}));

// ---- Firma con código ----
app.post('/api/firmas/solicitar', auth, wrap(async (req, res) => {
  const [docs] = await pool.query('SELECT id FROM documentos WHERE id = ?', [req.body.documento_id]);
  if (!docs.length) return res.status(404).json({ error: 'El documento no existe.' });
  const codigo = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(codigo, 8);
  const [r] = await pool.query(
    'INSERT INTO solicitudes_firma (documento_id, firmante_id, codigo_hash, expira_en) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [docs[0].id, req.user.id, hash]);
  // Aquí iría el envío real por correo o SMS (por ejemplo con nodemailer).
  console.log('[DEMO] Código para ' + req.user.correo + ': ' + codigo);
  const out = { id: r.insertId, correo: req.user.correo, expira_en: Date.now() + 5 * 60 * 1000 };
  if (process.env.MOSTRAR_CODIGO_DEMO === 'true') out.codigo_demo = codigo;
  res.json(out);
}));

app.post('/api/firmas/:id/verificar', auth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT s.*, d.titulo, d.contenido, (s.expira_en < NOW()) AS vencido FROM solicitudes_firma s JOIN documentos d ON d.id = s.documento_id WHERE s.id = ? AND s.firmante_id = ?',
    [req.params.id, req.user.id]);
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'No encontramos esa solicitud.' });
  if (s.estado !== 'pendiente') return res.status(400).json({ error: 'Esta solicitud ya no admite más intentos. Pide un código nuevo.' });
  if (s.vencido) return res.status(400).json({ error: 'El código venció. Pide uno nuevo.' });
  const ok = await bcrypt.compare(String(req.body.codigo || ''), s.codigo_hash);
  if (!ok) {
    const intentos = s.intentos + 1;
    await pool.query('UPDATE solicitudes_firma SET intentos = ?, estado = ? WHERE id = ?', [intentos, intentos >= 3 ? 'bloqueado' : 'pendiente', s.id]);
    return res.status(400).json({ error: intentos >= 3 ? 'Superaste los 3 intentos. Pide un código nuevo.' : 'El código no coincide. Te quedan ' + (3 - intentos) + ' intentos.' });
  }
  const cuando = new Date();
  const huella = crypto.createHash('sha256')
    .update([s.titulo, s.contenido, req.user.nombre, req.user.correo, cuando.toISOString()].join('|')).digest('hex');
  await pool.query('UPDATE solicitudes_firma SET estado = "firmado", huella_sha256 = ?, firmado_en = ? WHERE id = ?', [huella, cuando, s.id]);
  res.json({ huella, firmado_en: cuando.toISOString() });
}));

app.get('/api/firmas', auth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT s.id, d.titulo, s.huella_sha256, s.firmado_en FROM solicitudes_firma s JOIN documentos d ON d.id = s.documento_id WHERE s.firmante_id = ? AND s.estado = "firmado" ORDER BY s.firmado_en DESC',
    [req.user.id]);
  res.json(rows);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ECO DIGITAL en http://localhost:' + PORT + '/login.html'));
