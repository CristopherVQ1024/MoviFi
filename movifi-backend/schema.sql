CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  nombre TEXT,
  email TEXT UNIQUE NOT NULL,
  foto_url TEXT,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE especificaciones_vehiculo (
  id SERIAL PRIMARY KEY,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  anio INTEGER NOT NULL,
  tipo_combustible TEXT,
  rendimiento_km_por_galon NUMERIC(6,2),
  capacidad_tanque_galones NUMERIC(6,2),
  fuente TEXT,
  fecha_consulta TIMESTAMPTZ,
  UNIQUE (marca, modelo, anio)
);

CREATE TABLE vehiculos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  especificacion_id INTEGER NOT NULL REFERENCES especificaciones_vehiculo(id),
  placa TEXT,
  km_actual INTEGER NOT NULL DEFAULT 0,
  combustible_grado TEXT,
  rendimiento_manual NUMERIC(6,2),
  precio_galon NUMERIC(6,2),
  km_inicial INTEGER,
  combustible_mensual NUMERIC(10,2),
  capacidad_manual NUMERIC(5,1),
  nivel_combustible NUMERIC(3,1),
  km_nivel INTEGER,
  nivel_actualizado TIMESTAMPTZ,
  km_actualizado TIMESTAMPTZ,
  parcial_km_base INTEGER,
  parcial_desde TIMESTAMPTZ,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE precios_combustible (
  grado TEXT PRIMARY KEY,
  precio_galon NUMERIC(6,2) NOT NULL,
  fuente TEXT,
  fecha_consulta TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consejos_diarios (
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hash TEXT NOT NULL,
  texto TEXT NOT NULL,
  PRIMARY KEY (vehiculo_id, fecha)
);

CREATE TABLE lecturas_combustible (
  id SERIAL PRIMARY KEY,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  nivel_anterior NUMERIC(3,1),
  nivel NUMERIC(3,1) NOT NULL,
  monto_cargado NUMERIC(10,2) NOT NULL DEFAULT 0,
  km INTEGER,
  km_recorridos INTEGER,
  galones_consumidos NUMERIC(6,2),
  costo_estimado NUMERIC(10,2),
  rendimiento NUMERIC(6,2),
  km_estimados NUMERIC(8,1) NOT NULL DEFAULT 0
);
CREATE INDEX idx_lecturas_vehiculo_fecha ON lecturas_combustible (vehiculo_id, fecha DESC);

CREATE TABLE notas (
  id SERIAL PRIMARY KEY,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ
);
CREATE INDEX idx_notas_vehiculo ON notas (vehiculo_id, fecha DESC);

CREATE TABLE tipos_mantenimiento (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  frecuencia_km_sugerida INTEGER,
  frecuencia_meses_sugerida INTEGER,
  es_sistema BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE mantenimientos_programados (
  id SERIAL PRIMARY KEY,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  tipo_mantenimiento_id INTEGER NOT NULL REFERENCES tipos_mantenimiento(id),
  activo BOOLEAN NOT NULL DEFAULT true,
  ultima_fecha DATE,
  ultimo_km INTEGER,
  proxima_fecha DATE,
  proximo_km INTEGER,
  base_fecha DATE,
  base_km INTEGER,
  UNIQUE (vehiculo_id, tipo_mantenimiento_id)
);

CREATE TABLE presupuestos (
  id SERIAL PRIMARY KEY,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  mes DATE NOT NULL,
  monto_asignado NUMERIC(12,2) NOT NULL,
  fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehiculo_id, mes)
);

CREATE TABLE gastos (
  id SERIAL PRIMARY KEY,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  tipo_mantenimiento_id INTEGER REFERENCES tipos_mantenimiento(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('programado', 'no_programado')),
  categoria TEXT,
  monto NUMERIC(12,2) NOT NULL,
  descripcion TEXT,
  km INTEGER,
  fecha DATE NOT NULL,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gastos_vehiculo_fecha ON gastos (vehiculo_id, fecha);
CREATE INDEX idx_vehiculos_usuario ON vehiculos (usuario_id);

INSERT INTO tipos_mantenimiento (nombre, frecuencia_km_sugerida, frecuencia_meses_sugerida) VALUES
  ('SOAT', NULL, 12),
  ('Revisión Técnica', NULL, 12),
  ('Cambio de aceite', 5000, 6),
  ('Neumáticos', 40000, 36),
  ('Batería', NULL, 24),
  ('Filtros', 10000, 12),
  ('Otro', NULL, NULL);
