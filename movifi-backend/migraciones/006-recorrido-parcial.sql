-- Recorrido parcial (informativo): cuántos km se llevan desde la última vez que el usuario lo puso en 0.
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS parcial_km_base INTEGER,
  ADD COLUMN IF NOT EXISTS parcial_desde TIMESTAMPTZ;

UPDATE vehiculos SET parcial_km_base = km_actual, parcial_desde = now() WHERE parcial_km_base IS NULL;
