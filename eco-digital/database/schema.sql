CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('admin','usuario') NOT NULL DEFAULT 'usuario',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS archivos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  radicado VARCHAR(20) NULL UNIQUE,
  nombre_archivo VARCHAR(255) NOT NULL,
  tipo_mime VARCHAR(60) NOT NULL,
  tamano INT NOT NULL,
  tipo_documento VARCHAR(60) NOT NULL DEFAULT 'General',
  descripcion VARCHAR(255) NULL,
  tarea VARCHAR(120) NULL,
  estado ENUM('radicado','por_firmar','firmado') NOT NULL DEFAULT 'radicado',
  subido_por INT NOT NULL,
  firmante_id INT NULL,
  huella_sha256 CHAR(64) NULL,
  firmado_en DATETIME NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contenido LONGBLOB NOT NULL,
  FOREIGN KEY (subido_por) REFERENCES usuarios(id),
  FOREIGN KEY (firmante_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS codigos_firma (
  id INT AUTO_INCREMENT PRIMARY KEY,
  archivo_id INT NOT NULL,
  usuario_id INT NOT NULL,
  codigo_hash VARCHAR(255) NOT NULL,
  expira_en DATETIME NOT NULL,
  intentos TINYINT NOT NULL DEFAULT 0,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (archivo_id) REFERENCES archivos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  archivo_id INT NULL,
  accion VARCHAR(40) NOT NULL,
  detalle VARCHAR(255) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);
