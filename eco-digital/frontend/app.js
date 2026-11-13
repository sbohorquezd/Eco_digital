var TOKEN = localStorage.getItem('eco_token');
var USER = JSON.parse(localStorage.getItem('eco_user') || 'null');
if (!TOKEN || !USER) location.href = 'login.html';

var S = { step: 1, docs: [], doc: null, sol: null, hash: '', total: 0, timer: null };
var $ = function (i) { return document.getElementById(i); };
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function api(path, opts) {
  opts = opts || {};
  opts.headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };
  return fetch('/api' + path, opts).then(function (r) {
    return r.json().then(function (d) {
      if (r.status === 401) { salir(); }
      if (!r.ok) throw new Error(d.error || 'Ocurrió un error.');
      return d;
    });
  });
}
function salir() { localStorage.clear(); location.href = 'login.html'; }

function paper() {
  if (!S.doc) return;
  $('pTitle').textContent = S.doc.titulo;
  $('pMeta').textContent = S.doc.descripcion || '';
  $('pBody').innerHTML = S.doc.contenido.split('\n\n').map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
}
function steps() {
  var li = $('steps').children;
  for (var i = 0; i < li.length; i++) li[i].className = (i + 1 < S.step ? 'done' : '') + (i + 1 === S.step ? ' on' : '');
}
function contador() { $('saved').textContent = 'Documentos firmados por ti: ' + S.total; }

function render() {
  steps();
  var v = $('view');
  if (S.step === 1) {
    v.innerHTML = '<h2>Elige el documento</h2><p class="hint">Selecciona el documento que quieres firmar.</p>' +
      S.docs.map(function (d) {
        return '<label class="opt"><input type="radio" name="doc" value="' + d.id + '"' + (S.doc && d.id === S.doc.id ? ' checked' : '') +
          '><span><b>' + esc(d.titulo) + '</b><small>' + esc(d.descripcion || '') + '</small></span></label>';
      }).join('') + '<button id="n1">Continuar</button>';
    Array.prototype.forEach.call(document.getElementsByName('doc'), function (r) {
      r.onchange = function () { S.doc = S.docs.filter(function (d) { return String(d.id) === r.value; })[0]; paper(); };
    });
    $('n1').onclick = function () { S.step = 2; render(); };
  } else if (S.step === 2) {
    v.innerHTML = '<h2>Confirma al firmante</h2><p class="hint">Enviaremos un código de 6 dígitos al correo de tu cuenta.</p>' +
      '<div class="inbox"><b>' + esc(USER.nombre) + '</b><br>' + esc(USER.correo) + '</div>' +
      '<div class="err" id="err" role="alert"></div><button id="send">Enviar código</button><button class="ghost" id="back">Atrás</button>';
    $('back').onclick = function () { S.step = 1; render(); };
    $('send').onclick = solicitar;
  } else if (S.step === 3) {
    v.innerHTML = '<h2>Ingresa el código</h2><p class="hint">Enviamos un código a <b>' + esc(S.sol.correo) + '</b>.</p>' +
      (S.sol.codigo_demo ? '<div class="inbox">Bandeja simulada: mensaje de ECO DIGITAL<b class="code">' + esc(S.sol.codigo_demo) + '</b></div>' : '') +
      '<label for="code">Código de 6 dígitos</label><input type="text" id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code">' +
      '<div class="timer" id="timer"></div><div class="err" id="err" role="alert"></div>' +
      '<button id="ver">Firmar documento</button><button class="ghost" id="re">Reenviar código</button>';
    $('re').onclick = solicitar;
    $('ver').onclick = verificar;
    $('code').onkeydown = function (e) { if (e.key === 'Enter') verificar(); };
    tick(); clearInterval(S.timer); S.timer = setInterval(tick, 1000); $('code').focus();
  } else {
    clearInterval(S.timer);
    v.innerHTML = '<h2>Documento firmado</h2><p class="hint">La firma quedó guardada en la base de datos con fecha, hora y huella digital.</p>' +
      '<div class="inbox">Huella (SHA-256):<br><span style="overflow-wrap:anywhere;font-size:13px">' + esc(S.hash) + '</span></div>' +
      '<button id="otra">Firmar otro documento</button>';
    $('otra').onclick = reiniciar;
  }
}

function solicitar() {
  var er = $('err');
  api('/firmas/solicitar', { method: 'POST', body: JSON.stringify({ documento_id: S.doc.id }) })
    .then(function (d) { S.sol = d; S.step = 3; render(); })
    .catch(function (e) { if (er) er.textContent = e.message; });
}
function tick() {
  var t = $('timer'); if (!t || !S.sol) return;
  var s = Math.max(0, Math.round((S.sol.expira_en - Date.now()) / 1000));
  t.textContent = s > 0 ? 'El código vence en ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : 'El código venció. Pide uno nuevo.';
}
function verificar() {
  var er = $('err');
  api('/firmas/' + S.sol.id + '/verificar', { method: 'POST', body: JSON.stringify({ codigo: $('code').value.trim() }) })
    .then(function (d) {
      S.hash = d.huella; S.total++;
      var f = new Date(d.firmado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
      $('sig').innerHTML = '<div class="name">' + esc(USER.nombre) + '</div>';
      $('stamp').innerHTML = 'Firmado electrónicamente<br>' + esc(f) + '<br>ID ' + esc(d.huella.slice(0, 12));
      $('paper').classList.add('signed');
      contador(); S.step = 4; render();
    })
    .catch(function (e) { er.textContent = e.message; });
}
function reiniciar() {
  S.step = 1; S.sol = null; clearInterval(S.timer);
  $('paper').classList.remove('signed');
  $('sig').innerHTML = '<span class="pending">Firma pendiente</span>';
  render();
}

$('quien').textContent = USER.nombre;
$('salir').onclick = salir;
Promise.all([api('/documentos'), api('/firmas')]).then(function (r) {
  S.docs = r[0]; S.doc = S.docs[0]; S.total = r[1].length;
  paper(); contador(); render();
}).catch(function (e) { $('view').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
