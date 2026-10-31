-- Vehiculos duales: gasolina mas equipo a gas GLP con su propio medidor de 4 LEDs.
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS dual_glp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS glp_capacidad NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS glp_precio_galon NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS glp_rendimiento_manual NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS glp_nivel NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS glp_km_nivel INTEGER,
  ADD COLUMN IF NOT EXISTS glp_nivel_actualizado TIMESTAMPTZ;

ALTER TABLE lecturas_combustible
  ADD COLUMN IF NOT EXISTS combustible TEXT NOT NULL DEFAULT 'gasolina' CHECK (combustible IN ('gasolina', 'glp'));
