var modo = 'login';
var $ = function (i) { return document.getElementById(i); };
if (localStorage.getItem('eco_token')) location.href = 'index.html';

function setModo(m) {
  modo = m;
  $('tLogin').className = m === 'login' ? 'on' : '';
  $('tReg').className = m === 'registro' ? 'on' : '';
  $('rowNombre').hidden = m === 'login';
  $('ttl').textContent = m === 'login' ? 'Bienvenida' : 'Crea tu cuenta';
  $('sub').textContent = m === 'login' ? 'Ingresa con tu correo y contraseña.' : 'La contraseña debe tener mínimo 8 caracteres.';
  $('go').textContent = m === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
  $('pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('err').textContent = '';
}

function enviar() {
  var body = { correo: $('correo').value.trim(), password: $('pass').value };
  if (modo === 'registro') body.nombre = $('nombre').value;
  $('go').disabled = true;
  fetch('/api/auth/' + modo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'No pudimos continuar.'); return d; });
  }).then(function (d) {
    localStorage.setItem('eco_token', d.token);
    localStorage.setItem('eco_user', JSON.stringify(d.usuario));
    location.href = 'index.html';
  }).catch(function (e) {
    $('err').textContent = e.message === 'Failed to fetch' ? 'No hay conexión con el servidor. ¿Está corriendo npm start?' : e.message;
  }).then(function () { $('go').disabled = false; });
}

$('tLogin').onclick = function () { setModo('login'); };
$('tReg').onclick = function () { setModo('registro'); };
$('go').onclick = enviar;
$('pass').onkeydown = function (e) { if (e.key === 'Enter') enviar(); };
