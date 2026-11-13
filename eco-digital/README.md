# ECO DIGITAL – Gestión documental con firma por código

Dashboard, historial y gestión de documentos digitalizados (PDF, PNG, JPG) con radicación, tareas y firma electrónica por código enviado al correo.

## Probarlo en tu computador
1. Instala Node.js LTS y MySQL.
2. En MySQL crea la base: `CREATE DATABASE eco_digital;`
3. En esta carpeta: `copy .env.example .env` y edita `.env` (clave de MySQL, JWT_SECRET).
4. `npm install` y `npm start`. Las tablas se crean solas al arrancar.
5. Abre http://localhost:3000/login.html y crea una cuenta. La primera cuenta queda como administradora.
6. Sin `BREVO_API_KEY` y con `MOSTRAR_CODIGO_DEMO=true`, el código aparece en pantalla (modo demostración).

## Correo real (Brevo)
Render gratis bloquea los puertos SMTP (25, 465, 587), por eso se usa la API HTTPS de Brevo.
1. Crea cuenta en brevo.com, verifica un remitente (tu correo) en Senders.
2. Crea una API key (SMTP & API > API Keys).
3. En `.env` o en Render: `BREVO_API_KEY=...` y `MAIL_FROM=` (el remitente verificado).

## MySQL en la nube
Render no ofrece MySQL administrado (solo PostgreSQL). Usa un MySQL externo (Railway, Aiven, TiDB Cloud u otro) y copia sus datos a `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. Si exige SSL, `DB_SSL=true`.

## Desplegar en Render
1. Sube esta carpeta a un repositorio de GitHub (el `.gitignore` ya excluye `.env` y `node_modules`).
2. En Render: New > Web Service > tu repositorio.
3. Build Command: `npm install`. Start Command: `npm start`.
4. Environment: agrega las variables de `.env.example` con tus valores reales (no subas el `.env`).
5. Cuando termine el despliegue, abre la URL `https://TU-SERVICIO.onrender.com/login.html`.

## Notas
- Los archivos se guardan en MySQL (máx. 5 MB cada uno), porque el disco del plan gratis de Render se borra en cada reinicio.
- El plan gratis de Render se duerme tras un rato sin uso; la primera visita puede tardar.
- Es una firma electrónica simple (código al correo + huella SHA-256 + historial). No equivale a una firma digital certificada.
