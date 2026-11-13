var TOKEN = localStorage.getItem('eco_token');
var USER = JSON.parse(localStorage.getItem('eco_user') || 'null');
if (!TOKEN || !USER) location.href = 'login.html';

var $ = function (i) { return document.getElementById(i); };
var TAB = 'radicados', LISTA = [], USUARIOS = [], BLOB_URL = null;
var TIPOS = ['General', 'Contrato', 'Factura', 'Hoja de vida', 'Acta', 'Orden de compra', 'Otro'];
var ESTADOS = { radicado: 'Radicado', por_firmar: 'Por firmar', firmado: 'Firmado' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fecha(s) { return s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function salir() { localStorage.clear(); location.href = 'login.html'; }

function api(path, opts) {
  opts = opts || {};
  var h = { Authorization: 'Bearer ' + TOKEN };
  if (opts.body && !(opts.body instanceof FormData)) { h['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  opts.headers = h;
  return fetch('/api' + path, opts).then(function (r) {
    if (r.status === 401) salir();
    if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Ocurrió un error.'); });
    return (r.headers.get('content-type') || '').indexOf('application/json') > -1 ? r.json() : r.blob();
  });
}

/* ---------- Modal ---------- */
function abrir(html) { $('box').innerHTML = html; $('modal').hidden = false; }
function cerrar() { $('modal').hidden = true; $('box').innerHTML = ''; if (BLOB_URL) { URL.revokeObjectURL(BLOB_URL); BLOB_URL = null; } }
function msg(t) { var e = $('merr'); if (e) e.textContent = t; }

/* ---------- Vistas ---------- */
function card(t, n) { return '<div class="card"><b>' + n + '</b><span>' + t + '</span></div>'; }
function tablaHist(rows) {
  if (!rows.length) return '<div class="vacio">Todavía no hay movimientos.</div>';
  return '<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>' +
    rows.map(function (h) { return '<tr><td>' + fecha(h.creado_en) + '</td><td>' + esc(h.nombre) + '</td><td>' + esc(h.accion.replace(/_/g, ' ').toLowerCase()) + '</td><td>' + esc(h.detalle) + '</td></tr>'; }).join('') + '</tbody></table></div>';
}

function dash() {
  return api('/resumen').then(function (d) {
    $('main').innerHTML = '<h1>Dashboard</h1><div class="cards">' + card('Documentos radicados', d.total) + card('Sin enviar a firma', d.radicado) + card('Por firmar', d.por_firmar) + card('Firmados', d.firmado) + '</div>' +
      (d.mis_pendientes ? '<div class="alerta">Tienes <b>' + d.mis_pendientes + '</b> documento(s) esperando tu firma. <a href="#documentos" data-a="irfirmar">Ver documentos por firmar</a></div>' : '') +
      '<h2>Actividad reciente</h2>' + tablaHist(d.reciente);
  });
}

function hist() {
  return api('/historial').then(function (rows) { $('main').innerHTML = '<h1>Historial</h1>' + tablaHist(rows); });
}

function docs() {
  return Promise.all([api('/archivos?vista=' + TAB), api('/usuarios')]).then(function (r) {
    LISTA = r[0]; USUARIOS = r[1];
    var tabs = [['radicados', 'Radicación'], ['tareas', 'Tareas'], ['firmar', 'Por firmar']];
    $('main').innerHTML = '<h1>Gestión de documentos digitalizados</h1>' +
      '<div class="tabs">' + tabs.map(function (t) { return '<button data-a="tab" data-v="' + t[0] + '" class="' + (TAB === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="bar"><button data-a="subir">Cargar documento</button><input type="text" id="q" placeholder="Buscar por radicado, nombre o tarea"></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Radicado</th><th>Documento</th><th>Tarea</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody id="tb"></tbody></table></div>';
    $('q').oninput = filas;
    filas();
  });
}

function filas() {
  var q = $('q').value.toLowerCase();
  var rows = LISTA.filter(function (a) { return !q || (a.radicado + ' ' + a.nombre_archivo + ' ' + (a.tarea || '')).toLowerCase().indexOf(q) > -1; });
  $('tb').innerHTML = rows.length ? rows.map(function (a) {
    var mio = a.subido_por === USER.id || USER.rol === 'admin';
    var b = '<button class="mini" data-a="ver" data-id="' + a.id + '">Ver</button>';
    if (a.estado === 'radicado' && mio) b += '<button class="mini" data-a="enviar" data-id="' + a.id + '">Enviar a firma</button>';
    if (a.estado === 'por_firmar' && a.firmante_id === USER.id) b += '<button class="mini" data-a="firmar" data-id="' + a.id + '">Firmar</button>';
    if (a.estado === 'firmado') b += '<button class="mini" data-a="constancia" data-id="' + a.id + '">Constancia</button>';
    if (a.estado !== 'firmado' && mio) b += '<button class="mini danger" data-a="borrar" data-id="' + a.id + '">Eliminar</button>';
    return '<tr><td>' + esc(a.radicado) + '</td><td><b>' + esc(a.nombre_archivo) + '</b><br><small>' + esc(a.tipo_documento) + ' · ' + kb(a.tamano) + ' · ' + esc(a.subido_por_nombre) + '</small></td>' +
      '<td>' + esc(a.tarea || '—') + '</td><td><span class="badge ' + a.estado + '">' + ESTADOS[a.estado] + '</span>' + (a.firmante_nombre ? '<br><small>Firma: ' + esc(a.firmante_nombre) + '</small>' : '') + '</td>' +
      '<td>' + fecha(a.creado_en) + '</td><td class="acc">' + b + '</td></tr>';
  }).join('') : '<tr><td colspan="6" class="vacio">No hay documentos en esta vista.</td></tr>';
}

function buscar(id) { return LISTA.filter(function (a) { return String(a.id) === String(id); })[0]; }

/* ---------- Acciones ---------- */
function modalSubir() {
  abrir('<h2>Cargar documento</h2><p class="hint">Al cargarlo se le asigna un número de radicado.</p>' +
    '<label for="f_arch">Archivo (PDF, PNG o JPG, máximo 5 MB)</label><input type="file" id="f_arch" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg">' +
    '<label for="f_tipo">Tipo de documento</label><select id="f_tipo">' + TIPOS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
    '<label for="f_tarea">Tarea asociada (opcional)</label><input type="text" id="f_tarea" list="tareas" maxlength="120"><datalist id="tareas"><option>Contratación</option><option>Afiliación</option><option>Facturación</option><option>Archivo</option></datalist>' +
    '<label for="f_desc">Descripción (opcional)</label><input type="text" id="f_desc" maxlength="200">' +
    '<div class="err" id="merr" role="alert"></div><button id="f_ok">Radicar documento</button><button class="ghost" data-a="cerrar">Cancelar</button>');
  $('f_ok').onclick = function () {
    var f = $('f_arch').files[0];
    if (!f) return msg('Selecciona un archivo.');
    if (f.size > 5 * 1024 * 1024) return msg('El archivo supera los 5 MB.');
    var fd = new FormData();
    fd.append('archivo', f); fd.append('tipo_documento', $('f_tipo').value); fd.append('tarea', $('f_tarea').value); fd.append('descripcion', $('f_desc').value);
    $('f_ok').disabled = true; msg('Cargando…');
    api('/archivos', { method: 'POST', body: fd }).then(function () { cerrar(); docs(); }).catch(function (e) { msg(e.message); $('f_ok').disabled = false; });
  };
}

function ver(id) {
  var a = buscar(id);
  api('/archivos/' + id + '/contenido').then(function (blob) {
    BLOB_URL = URL.createObjectURL(blob);
    abrir('<h2>' + esc(a.nombre_archivo) + '</h2><p class="hint">' + esc(a.radicado) + '</p>' +
      (blob.type === 'application/pdf' ? '<iframe src="' + BLOB_URL + '" title="Vista del documento"></iframe>' : '<img src="' + BLOB_URL + '" alt="' + esc(a.nombre_archivo) + '">') +
      '<button class="ghost" style="margin-left:0" data-a="cerrar">Cerrar</button>');
  }).catch(function (e) { alert(e.message); });
}

function modalEnviar(id) {
  var a = buscar(id);
  abrir('<h2>Enviar a firma</h2><p class="hint">' + esc(a.radicado) + ' · ' + esc(a.nombre_archivo) + '</p>' +
    '<label for="f_firm">¿Quién debe firmar?</label><select id="f_firm">' + USUARIOS.map(function (u) { return '<option value="' + u.id + '">' + esc(u.nombre) + ' (' + esc(u.correo) + ')</option>'; }).join('') + '</select>' +
    '<div class="err" id="merr" role="alert"></div><button id="f_ok">Enviar a firma</button><button class="ghost" data-a="cerrar">Cancelar</button>');
  $('f_ok').onclick = function () {
    api('/archivos/' + id + '/enviar-firma', { method: 'POST', body: { firmante_id: $('f_firm').value } }).then(function () { cerrar(); docs(); }).catch(function (e) { msg(e.message); });
  };
}

function modalFirmar(id) {
  var a = buscar(id);
  abrir('<h2>Firmar documento</h2><p class="hint">' + esc(a.radicado) + ' · ' + esc(a.nombre_archivo) + '</p>' +
    '<p>Te enviaremos un código de 6 dígitos a <b>' + esc(USER.correo) + '</b>.</p><div id="paso"></div>' +
    '<div class="err" id="merr" role="alert"></div><button id="f_env">Enviar código</button><button class="ghost" data-a="cerrar">Cancelar</button>');
  $('f_env').onclick = function () {
    $('f_env').disabled = true; msg('Enviando…');
    api('/archivos/' + id + '/codigo', { method: 'POST' }).then(function (d) {
      msg('');
      $('paso').innerHTML = (d.codigo_demo ? '<div class="inbox">Modo demostración. Tu código es:<b class="code">' + esc(d.codigo_demo) + '</b></div>' : '<div class="inbox">Código enviado. Revisa tu bandeja de entrada y la carpeta de spam. Vence en 5 minutos.</div>') +
        '<label for="codigo">Código de 6 dígitos</label><input type="text" id="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><button id="f_ver">Firmar documento</button>';
      $('f_env').textContent = 'Reenviar código'; $('f_env').disabled = false; $('f_env').className = 'ghost'; $('f_env').style.marginLeft = '8px';
      $('codigo').focus();
      $('codigo').onkeydown = function (e) { if (e.key === 'Enter') $('f_ver').click(); };
      $('f_ver').onclick = function () {
        api('/archivos/' + id + '/firmar', { method: 'POST', body: { codigo: $('codigo').value.trim() } }).then(function (r) {
          abrir('<h2>Documento firmado</h2><p class="hint">' + esc(a.radicado) + ' · ' + fecha(r.firmado_en) + '</p><div class="inbox">Huella digital (SHA-256):<br>' + esc(r.huella) + '</div><button data-a="cerrar">Listo</button>');
          docs();
        }).catch(function (e) { msg(e.message); });
      };
    }).catch(function (e) { msg(e.message); $('f_env').disabled = false; });
  };
}

function constancia(id) {
  var a = buscar(id);
  abrir('<h2>Constancia de firma</h2><p><b>' + esc(a.radicado) + '</b> · ' + esc(a.nombre_archivo) + '</p>' +
    '<p>Firmado por <b>' + esc(a.firmante_nombre) + '</b> el ' + fecha(a.firmado_en) + '.</p><div class="inbox">Huella digital (SHA-256):<br>' + esc(a.huella_sha256) + '</div><button data-a="cerrar">Cerrar</button>');
}

function borrar(id) {
  var a = buscar(id);
  if (!confirm('¿Eliminar ' + a.radicado + ' (' + a.nombre_archivo + ')? Esta acción no se puede deshacer.')) return;
  api('/archivos/' + id, { method: 'DELETE' }).then(docs).catch(function (e) { alert(e.message); });
}

/* ---------- Router y eventos ---------- */
var VISTAS = { dashboard: dash, historial: hist, documentos: docs };
function route() {
  var r = (location.hash || '#dashboard').slice(1);
  if (!VISTAS[r]) r = 'dashboard';
  document.querySelectorAll('nav a').forEach(function (a) { a.className = a.dataset.r === r ? 'on' : ''; });
  $('main').innerHTML = '<p class="hint">Cargando…</p>';
  VISTAS[r]().catch(function (e) { $('main').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
}

document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]');
  if (e.target === $('modal')) return cerrar();
  if (!b) return;
  var a = b.dataset.a, id = b.dataset.id;
  if (a === 'cerrar') cerrar();
  else if (a === 'tab') { TAB = b.dataset.v; docs(); }
  else if (a === 'irfirmar') TAB = 'firmar';
  else if (a === 'subir') modalSubir();
  else if (a === 'ver') ver(id);
  else if (a === 'enviar') modalEnviar(id);
  else if (a === 'firmar') modalFirmar(id);
  else if (a === 'constancia') constancia(id);
  else if (a === 'borrar') borrar(id);
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) cerrar(); });
window.addEventListener('hashchange', route);
$('quien').textContent = USER.nombre;
$('rol').textContent = USER.rol === 'admin' ? 'Administrador/a' : 'Usuario';
$('salir').onclick = salir;
route();
