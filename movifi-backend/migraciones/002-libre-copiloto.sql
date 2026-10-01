-- Gasto mensual típico en combustible (lo declara el usuario) y caché diaria del consejo del copiloto.
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS combustible_mensual NUMERIC(10,2);

CREATE TABLE IF NOT EXISTS consejos_diarios (
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hash TEXT NOT NULL,
  texto TEXT NOT NULL,
  PRIMARY KEY (vehiculo_id, fecha)
);
