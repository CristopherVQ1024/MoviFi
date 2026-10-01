-- Odómetro estimado: se cuenta cuándo fue la última vez que el usuario fijó el odómetro real, y cuántos km
-- estimados aportó cada lectura del medidor desde entonces. Además, notas libres sobre el auto.
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS km_actualizado TIMESTAMPTZ;
UPDATE vehiculos SET km_actualizado = now() WHERE km_actualizado IS NULL;

ALTER TABLE lecturas_combustible ADD COLUMN IF NOT EXISTS km_estimados NUMERIC(8,1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS notas (
  id SERIAL PRIMARY KEY,
  vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notas_vehiculo ON notas (vehiculo_id, fecha DESC);
