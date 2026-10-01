-- El seguimiento de mantenimientos se calcula desde el historial de gastos (se guarda el km de cada servicio)
-- y desde una base opcional que el usuario indica al empezar a seguir un mantenimiento.
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS km INTEGER;
ALTER TABLE mantenimientos_programados
  ADD COLUMN IF NOT EXISTS base_fecha DATE,
  ADD COLUMN IF NOT EXISTS base_km INTEGER;

-- los gastos existentes heredan el km que ya tenia el seguimiento cuando coinciden en fecha
UPDATE gastos g SET km = mp.ultimo_km
FROM mantenimientos_programados mp
WHERE g.km IS NULL AND g.vehiculo_id = mp.vehiculo_id AND g.tipo_mantenimiento_id = mp.tipo_mantenimiento_id
  AND g.fecha = mp.ultima_fecha AND mp.ultimo_km IS NOT NULL;
