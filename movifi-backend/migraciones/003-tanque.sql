-- Medidor de combustible (10 barras): nivel actual, capacidad corregida por el usuario e historial de lecturas.
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS capacidad_manual NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS nivel_combustible NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS km_nivel INTEGER,
  ADD COLUMN IF NOT EXISTS nivel_actualizado TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS lecturas_combustible (
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
  rendimiento NUMERIC(6,2)
);
CREATE INDEX IF NOT EXISTS idx_lecturas_vehiculo_fecha ON lecturas_combustible (vehiculo_id, fecha DESC);
