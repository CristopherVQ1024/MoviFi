-- Margen de error relativo del rendimiento de cada tramo, por la precision de lectura del medidor (0.1 barra).
ALTER TABLE lecturas_combustible ADD COLUMN IF NOT EXISTS margen_error NUMERIC(5,3);

-- tramos con rendimiento ya guardados: 0.1 barra en galones / galones consumidos
UPDATE lecturas_combustible l
SET margen_error = 0.1 * (COALESCE(v.capacidad_manual, e.capacidad_tanque_galones) / 10) / l.galones_consumidos
FROM vehiculos v JOIN especificaciones_vehiculo e ON e.id = v.especificacion_id
WHERE l.vehiculo_id = v.id AND l.rendimiento IS NOT NULL AND l.margen_error IS NULL AND l.galones_consumidos > 0;
