require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('Falta JWT_SECRET en las variables de entorno'); process.exit(1); }

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'eco_digital',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const usuario = { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol };
  return { token: jwt.sign(usuario, SECRET, { expiresIn: '4h' }), usuario };
}

const log = (uid, aid, accion, detalle) =>
  pool.query('INSERT INTO historial (usuario_id, archivo_id, accion, detalle) VALUES (?,?,?,?)', [uid, aid, accion, detalle]);

// Cada usuario ve lo que subió o lo que debe firmar; el admin ve todo.
const vis = u => u.rol === 'admin' ? { sql: '1=1', params: [] } : { sql: '(a.subido_por = ? OR a.firmante_id = ?)', params: [u.id, u.id] };

async function uno(id, user, conContenido) {
  const v = vis(user);
  const cols = conContenido ? 'a.*' : 'a.id, a.radicado, a.nombre_archivo, a.estado, a.subido_por, a.firmante_id';
  const [rows] = await pool.query('SELECT ' + cols + ' FROM archivos a WHERE a.id = ? AND ' + v.sql, [id].concat(v.params));
  return rows[0];
}

function tipoReal(b) {
  if (b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (b.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  return null;
}

// Correo real por la API HTTPS de Brevo (Render gratis bloquea los puertos SMTP).
async function enviarCodigo(para, nombre, codigo, doc) {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    if (process.env.MOSTRAR_CODIGO_DEMO === 'true') { console.log('[DEMO] Código para ' + para + ': ' + codigo); return 'demo'; }
    throw new Error('SIN_CORREO');
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'ECO DIGITAL', email: process.env.MAIL_FROM },
      to: [{ email: para, name: nombre }],
      subject: 'Tu código de firma ECO DIGITAL',
      htmlContent: '<p>Hola ' + nombre + ',</p><p>Tu código para firmar el documento <b>' + doc + '</b> es:</p>' +
        '<p style="font-size:28px;letter-spacing:6px"><b>' + codigo + '</b></p><p>Vence en 5 minutos. Si no lo solicitaste, ignora este mensaje.</p>'
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) { console.error('Brevo', r.status, await r.text()); throw new Error('FALLO_CORREO'); }
  return 'enviado';
}

// ---- Autenticación ----
app.post('/api/auth/registro', wrap(async (req, res) => {
  const { nombre, correo, password } = req.body || {};
  if (!nombre || nombre.trim().length < 3) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo || '')) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres.' });
  const [ya] = await pool.query('SELECT id FROM usuarios WHERE correo = ?', [correo]);
  if (ya.length) return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM usuarios');
  const rol = c === 0 ? 'admin' : 'usuario'; // la primera cuenta queda como administradora
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query('INSERT INTO usuarios (nombre, correo, password_hash, rol) VALUES (?,?,?,?)', [nombre.trim(), correo, hash, rol]);
  await log(r.insertId, null, 'REGISTRO', 'Cuenta creada');
  res.json(token({ id: r.insertId, nombre: nombre.trim(), correo, rol }));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { correo, password } = req.body || {};
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ?', [correo || '']);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  await log(u.id, null, 'LOGIN', 'Inicio de sesión');
  res.json(token(u));
}));

app.get('/api/usuarios', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, nombre, correo FROM usuarios ORDER BY nombre');
  res.json(rows);
}));

// ---- Dashboard e historial ----
app.get('/api/resumen', auth, wrap(async (req, res) => {
  const v = vis(req.user);
  const [est] = await pool.query('SELECT a.estado, COUNT(*) AS n FROM archivos a WHERE ' + v.sql + ' GROUP BY a.estado', v.params);
  const r = { total: 0, radicado: 0, por_firmar: 0, firmado: 0 };
  est.forEach(e => { r[e.estado] = e.n; r.total += e.n; });
  const [[m]] = await pool.query("SELECT COUNT(*) AS n FROM archivos WHERE firmante_id = ? AND estado = 'por_firmar'", [req.user.id]);
  r.mis_pendientes = m.n;
  const h = req.user.rol === 'admin' ? '1=1' : 'h.usuario_id = ?';
  const [rec] = await pool.query('SELECT h.*, u.nombre FROM historial h JOIN usuarios u ON u.id = h.usuario_id WHERE ' + h + ' ORDER BY h.id DESC LIMIT 6', req.user.rol === 'admin' ? [] : [req.user.id]);
  r.reciente = rec;
  res.json(r);
}));

app.get('/api/historial', auth, wrap(async (req, res) => {
  const h = req.user.rol === 'admin' ? '1=1' : 'h.usuario_id = ?';
  const [rows] = await pool.query('SELECT h.*, u.nombre FROM historial h JOIN usuarios u ON u.id = h.usuario_id WHERE ' + h + ' ORDER BY h.id DESC LIMIT 200', req.user.rol === 'admin' ? [] : [req.user.id]);
  res.json(rows);
}));

// ---- Gestión de documentos ----
app.get('/api/archivos', auth, wrap(async (req, res) => {
  const v = vis(req.user);
  let w = v.sql;
  if (req.query.vista === 'tareas') w += " AND a.tarea IS NOT NULL AND a.tarea <> ''";
  if (req.query.vista === 'firmar') w += " AND a.estado IN ('por_firmar','firmado')";
  const [rows] = await pool.query(
    'SELECT a.id, a.radicado, a.nombre_archivo, a.tipo_mime, a.tamano, a.tipo_documento, a.descripcion, a.tarea, a.estado, a.subido_por, a.firmante_id, a.huella_sha256, a.firmado_en, a.creado_en, u.nombre AS subido_por_nombre, f.nombre AS firmante_nombre ' +
    'FROM archivos a JOIN usuarios u ON u.id = a.subido_por LEFT JOIN usuarios f ON f.id = a.firmante_id WHERE ' + w + ' ORDER BY a.id DESC LIMIT 300', v.params);
  res.json(rows);
}));

app.post('/api/archivos', auth, upload.single('archivo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo PDF, PNG o JPG.' });
  const mime = tipoReal(req.file.buffer);
  if (!mime) return res.status(400).json({ error: 'El archivo no es un PDF, PNG o JPG válido.' });
  const b = req.body;
  const nombre = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 255);
  const [r] = await pool.query(
    'INSERT INTO archivos (nombre_archivo, tipo_mime, tamano, tipo_documento, descripcion, tarea, subido_por, contenido) VALUES (?,?,?,?,?,?,?,?)',
    [nombre, mime, req.file.size, (b.tipo_documento || 'General').slice(0, 60), (b.descripcion || '').slice(0, 255) || null, (b.tarea || '').trim().slice(0, 120) || null, req.user.id, req.file.buffer]);
  const radicado = 'RAD-' + new Date().getFullYear() + '-' + String(r.insertId).padStart(6, '0');
  await pool.query('UPDATE archivos SET radicado = ? WHERE id = ?', [radicado, r.insertId]);
  await log(req.user.id, r.insertId, 'RADICACION', radicado + ' · ' + nombre);
  res.json({ id: r.insertId, radicado });
}));

app.get('/api/archivos/:id/contenido', auth, wrap(async (req, res) => {
  const a = await uno(req.params.id, req.user, true);
  if (!a) return res.status(404).json({ error: 'No encontramos el documento.' });
  res.set({ 'Content-Type': a.tipo_mime, 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(a.nombre_archivo), 'X-Content-Type-Options': 'nosniff' });
  res.send(a.contenido);
}));

app.delete('/api/archivos/:id', auth, wrap(async (req, res) => {
  const a = await uno(req.params.id, req.user, false);
  if (!a) return res.status(404).json({ error: 'No encontramos el documento.' });
  if (a.estado === 'firmado') return res.status(400).json({ error: 'Un documento firmado no se puede eliminar.' });
  if (a.subido_por !== req.user.id && req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo quien lo radicó puede eliminarlo.' });
  await pool.query('DELETE FROM archivos WHERE id = ?', [a.id]);
  await log(req.user.id, null, 'ELIMINACION', a.radicado + ' · ' + a.nombre_archivo);
  res.json({ ok: true });
}));

app.post('/api/archivos/:id/enviar-firma', auth, wrap(async (req, res) => {
  const a = await uno(req.params.id, req.user, false);
  if (!a) return res.status(404).json({ error: 'No encontramos el documento.' });
  if (a.subido_por !== req.user.id && req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo quien lo radicó puede enviarlo a firma.' });
  if (a.estado !== 'radicado') return res.status(400).json({ error: 'Este documento ya fue enviado a firma.' });
  const [f] = await pool.query('SELECT id, nombre FROM usuarios WHERE id = ?', [req.body.firmante_id]);
  if (!f.length) return res.status(400).json({ error: 'Elige quién debe firmar.' });
  await pool.query("UPDATE archivos SET estado = 'por_firmar', firmante_id = ? WHERE id = ?", [f[0].id, a.id]);
  await log(req.user.id, a.id, 'ENVIO_FIRMA', a.radicado + ' → ' + f[0].nombre);
  res.json({ ok: true });
}));

// ---- Firma con código enviado al correo ----
app.post('/api/archivos/:id/codigo', auth, wrap(async (req, res) => {
  const a = await uno(req.params.id, req.user, false);
  if (!a || a.estado !== 'por_firmar' || a.firmante_id !== req.user.id) return res.status(400).json({ error: 'Este documento no está pendiente de tu firma.' });
  const codigo = String(crypto.randomInt(100000, 1000000));
  let modo;
  try { modo = await enviarCodigo(req.user.correo, req.user.nombre, codigo, a.radicado + ' (' + a.nombre_archivo + ')'); }
  catch (e) {
    return res.status(503).json({ error: e.message === 'SIN_CORREO' ? 'El envío de correo no está configurado en el servidor.' : 'No pudimos enviar el correo. Intenta de nuevo en un momento.' });
  }
  await pool.query('UPDATE codigos_firma SET usado = 1 WHERE archivo_id = ? AND usuario_id = ?', [a.id, req.user.id]);
  await pool.query('INSERT INTO codigos_firma (archivo_id, usuario_id, codigo_hash, expira_en) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))', [a.id, req.user.id, await bcrypt.hash(codigo, 8)]);
  await log(req.user.id, a.id, 'CODIGO_ENVIADO', 'Código enviado a ' + req.user.correo);
  const out = { correo: req.user.correo };
  if (modo === 'demo') out.codigo_demo = codigo;
  res.json(out);
}));

app.post('/api/archivos/:id/firmar', auth, wrap(async (req, res) => {
  const a = await uno(req.params.id, req.user, true);
  if (!a || a.estado !== 'por_firmar' || a.firmante_id !== req.user.id) return res.status(400).json({ error: 'Este documento no está pendiente de tu firma.' });
  const [cs] = await pool.query('SELECT *, (expira_en < NOW()) AS vencido FROM codigos_firma WHERE archivo_id = ? AND usuario_id = ? AND usado = 0 ORDER BY id DESC LIMIT 1', [a.id, req.user.id]);
  const c = cs[0];
  if (!c) return res.status(400).json({ error: 'Primero pide un código. Pulsa “Enviar código”.' });
  if (c.vencido) return res.status(400).json({ error: 'El código venció. Pide uno nuevo.' });
  if (!(await bcrypt.compare(String(req.body.codigo || ''), c.codigo_hash))) {
    const n = c.intentos + 1;
    await pool.query('UPDATE codigos_firma SET intentos = ?, usado = ? WHERE id = ?', [n, n >= 3 ? 1 : 0, c.id]);
    await log(req.user.id, a.id, 'CODIGO_INCORRECTO', a.radicado);
    return res.status(400).json({ error: n >= 3 ? 'Superaste los 3 intentos. Pide un código nuevo.' : 'El código no coincide. Te quedan ' + (3 - n) + ' intentos.' });
  }
  const cuando = new Date();
  const huellaArchivo = crypto.createHash('sha256').update(a.contenido).digest('hex');
  const huella = crypto.createHash('sha256').update([huellaArchivo, a.radicado, req.user.correo, cuando.toISOString()].join('|')).digest('hex');
  await pool.query('UPDATE codigos_firma SET usado = 1 WHERE id = ?', [c.id]);
  await pool.query("UPDATE archivos SET estado = 'firmado', huella_sha256 = ?, firmado_en = NOW() WHERE id = ?", [huella, a.id]);
  await log(req.user.id, a.id, 'FIRMA', a.radicado + ' firmado por ' + req.user.nombre);
  res.json({ huella, firmado_en: cuando.toISOString() });
}));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo supera los 5 MB.' });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor.' });
});

async function iniciar() {
  const sql = fs.readFileSync(path.join(__dirname, 'database/schema.sql'), 'utf8');
  for (const s of sql.split(';').map(x => x.trim()).filter(Boolean)) await pool.query(s);
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('ECO DIGITAL en http://localhost:' + PORT + '/login.html'));
}
iniciar().catch(e => { console.error('No se pudo conectar a MySQL:', e.message); process.exit(1); });
