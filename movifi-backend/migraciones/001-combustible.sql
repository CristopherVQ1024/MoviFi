-- Combustible: grado elegido, rendimiento corregido por el usuario, precio de referencia y km de partida.
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS combustible_grado TEXT,
  ADD COLUMN IF NOT EXISTS rendimiento_manual NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS precio_galon NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS km_inicial INTEGER;

UPDATE vehiculos SET km_inicial = km_actual WHERE km_inicial IS NULL AND km_actual > 0;

-- cache del precio promedio por galón (la IA lo busca como máximo una vez por semana)
CREATE TABLE IF NOT EXISTS precios_combustible (
  grado TEXT PRIMARY KEY,
  precio_galon NUMERIC(6,2) NOT NULL,
  fuente TEXT,
  fecha_consulta TIMESTAMPTZ NOT NULL DEFAULT now()
);
