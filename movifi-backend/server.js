const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool, types } = require('pg');
const { OAuth2Client } = require('google-auth-library');

// las columnas DATE se manejan como texto AAAA-MM-DD: asi una fecha no se corre un dia segun la zona horaria del servidor
types.setTypeParser(1082, (valor) => valor);

const app = express();
// en produccion el frontend vive en el mismo dominio (via proxy); CORS_ORIGIN, si existe, limita los origenes permitidos
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined));
app.use(express.json());

// Express 4 no captura errores de handlers async y el proceso moriria: se responde 500 y el servidor sigue vivo
for (const metodo of ['get', 'post', 'patch', 'delete']) {
  const original = app[metodo].bind(app);
  app[metodo] = (ruta, ...handlers) => original(ruta, ...handlers.map((h) => (req, res, next) =>
    Promise.resolve(h(req, res, next)).catch((e) => {
      console.error(`${req.method} ${req.path}:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'error interno' });
    })));
}

const pool = new Pool();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'sin token' });
  try {
    const payload = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    req.usuarioId = payload.usuarioId;
    next();
  } catch (e) {
    res.status(401).json({ error: 'token invalido' });
  }
}

async function vehiculoDeUsuario(id, usuarioId) {
  const r = await pool.query(
    `SELECT v.*, e.marca, e.modelo, e.anio, e.tipo_combustible, e.rendimiento_km_por_galon, e.capacidad_tanque_galones
     FROM vehiculos v JOIN especificaciones_vehiculo e ON e.id = v.especificacion_id
     WHERE v.id=$1 AND v.usuario_id=$2`, [id, usuarioId]);
  return r.rows[0];
}

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// suma meses a una fecha AAAA-MM-DD sin zonas horarias; si el dia no existe en el mes destino, usa el ultimo (31 ago + 6 meses = 28 feb)
function sumarMeses(fecha, meses) {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + meses;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const ultimoDia = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`;
}

function hoyLocal() {
  return new Date().toLocaleDateString('en-CA');
}

function textoDeConversacion(data) {
  const outputs = data.outputs || [];
  for (const o of outputs) {
    if (o.type !== 'message.output') continue;
    if (typeof o.content === 'string') return o.content;
    if (Array.isArray(o.content)) {
      for (const c of o.content) if (c.type === 'text' && c.text) return c.text;
    }
  }
  return JSON.stringify(data);
}

const GRADOS = ['Regular 90', 'Premium 95', 'Premium 97', 'Diésel', 'GLP', 'GNV'];

// consulta a Mistral con su tool web_search y devuelve el JSON que respondio
async function consultarWebJson(pregunta) {
  const r = await fetch('https://api.mistral.ai/v1/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      instructions: 'Busca informacion vigente en la web. Responde solo JSON valido, sin texto extra.',
      tools: [{ type: 'web_search' }],
      inputs: pregunta
    })
  });
  const data = await r.json();
  return JSON.parse(textoDeConversacion(data).replace(/```json|```/g, '').trim());
}

async function buscarSpecsVehiculo(marca, modelo, anio) {
  const specs = await consultarWebJson(`Busca specs del ${marca} ${modelo} ${anio} tal como se vende en Peru y Latinoamerica (version mas comun). tipo_combustible: UNA sola palabra (Gasolina, Diesel, Hibrido, Electrico o GLP). rendimiento_km_por_galon: consumo mixto realista en uso real ciudad y carretera, en km por galon (no el ciclo europeo optimista). capacidad_tanque_galones: galones. Responde solo: {"tipo_combustible":"","rendimiento_km_por_galon":0,"capacidad_tanque_galones":0}`);
  const rendimiento = Number(specs.rendimiento_km_por_galon);
  const tanque = Number(specs.capacidad_tanque_galones);
  if (!specs.tipo_combustible || !(rendimiento > 0) || !(tanque > 0)) throw new Error('specs incompletas');
  return { tipo_combustible: specs.tipo_combustible, rendimiento_km_por_galon: rendimiento, capacidad_tanque_galones: tanque };
}

// precio promedio por galon (S/) de un grado de combustible: cache de 7 dias, la IA lo busca si esta vencido
async function precioReferencia(grado) {
  if (!grado) return null;
  const c = await pool.query('SELECT * FROM precios_combustible WHERE grado=$1', [grado]);
  const fila = c.rows[0];
  if (fila && Date.now() - new Date(fila.fecha_consulta).getTime() < 7 * 86400000) return Number(fila.precio_galon);
  try {
    const d = await consultarWebJson(`Busca el precio promedio actual en soles peruanos (PEN) de un galon de ${grado} en grifos de Lima, Peru. Responde solo: {"precio_galon":0}`);
    const precio = Number(d.precio_galon);
    if (!(precio >= 5 && precio <= 40)) throw new Error('precio fuera de rango');
    await pool.query(
      'INSERT INTO precios_combustible (grado,precio_galon,fuente,fecha_consulta) VALUES ($1,$2,$3,now()) ON CONFLICT (grado) DO UPDATE SET precio_galon=EXCLUDED.precio_galon, fuente=EXCLUDED.fuente, fecha_consulta=now()',
      [grado, precio, 'IA-busqueda-web']);
    return precio;
  } catch (e) {
    return fila ? Number(fila.precio_galon) : null;
  }
}

// El seguimiento de un mantenimiento se calcula siempre desde su historial: el servicio mas reciente entre los
// gastos registrados y la base que indico el usuario al empezar a seguirlo. Asi, registrar, borrar o cargar
// servicios antiguos nunca deja un seguimiento desactualizado. Un servicio sin km conocido solo avisa por fecha.
async function recalcularMantenimiento(vehiculoId, tipoMantId) {
  const tipoRes = await pool.query('SELECT * FROM tipos_mantenimiento WHERE id=$1', [tipoMantId]);
  const tipo = tipoRes.rows[0];
  if (!tipo) return;
  const existe = await pool.query('SELECT id, base_fecha, base_km FROM mantenimientos_programados WHERE vehiculo_id=$1 AND tipo_mantenimiento_id=$2', [vehiculoId, tipoMantId]);
  const fila = existe.rows[0];
  const g = await pool.query('SELECT fecha, km FROM gastos WHERE vehiculo_id=$1 AND tipo_mantenimiento_id=$2 AND fecha <= $3::date ORDER BY fecha DESC, id DESC LIMIT 1', [vehiculoId, tipoMantId, hoyLocal()]);
  const candidatos = [];
  if (g.rows[0]) candidatos.push({ fecha: g.rows[0].fecha, km: g.rows[0].km });
  if (fila?.base_fecha) candidatos.push({ fecha: fila.base_fecha, km: fila.base_km });
  candidatos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  const ultimo = candidatos[0] ?? null;

  const proximaFecha = ultimo && tipo.frecuencia_meses_sugerida ? sumarMeses(ultimo.fecha, tipo.frecuencia_meses_sugerida) : null;
  const proximoKm = ultimo && ultimo.km != null && tipo.frecuencia_km_sugerida ? ultimo.km + tipo.frecuencia_km_sugerida : null;
  if (fila) {
    await pool.query(
      'UPDATE mantenimientos_programados SET activo=true, ultima_fecha=$1, ultimo_km=$2, proxima_fecha=$3, proximo_km=$4 WHERE id=$5',
      [ultimo?.fecha ?? null, ultimo?.km ?? null, proximaFecha, proximoKm, fila.id]);
  } else {
    await pool.query(
      'INSERT INTO mantenimientos_programados (vehiculo_id,tipo_mantenimiento_id,activo,ultima_fecha,ultimo_km,proxima_fecha,proximo_km) VALUES ($1,$2,true,$3,$4,$5,$6)',
      [vehiculoId, tipoMantId, ultimo?.fecha ?? null, ultimo?.km ?? null, proximaFecha, proximoKm]);
  }
}

// Empieza (o reactiva) el seguimiento de un mantenimiento. Opcionalmente recibe la ultima vez que se hizo (fecha y km).
async function seguirMantenimiento(v, { tipo_mantenimiento_id, ultima_fecha, ultimo_km }) {
  const tipo = await pool.query('SELECT id FROM tipos_mantenimiento WHERE id=$1', [tipo_mantenimiento_id]);
  if (!tipo.rows[0]) return { status: 400, error: 'tipo invalido' };
  let baseFecha = null;
  let baseKm = null;
  if (ultima_fecha != null && ultima_fecha !== '') {
    const valida = typeof ultima_fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ultima_fecha) && sumarMeses(ultima_fecha, 0) === ultima_fecha && ultima_fecha <= hoyLocal();
    if (!valida) return { status: 400, error: 'fecha invalida' };
    baseFecha = ultima_fecha;
    if (ultimo_km != null && ultimo_km !== '') {
      baseKm = Number(ultimo_km);
      if (!(Number.isInteger(baseKm) && baseKm >= 0 && baseKm <= 3000000)) return { status: 400, error: 'km invalido' };
    }
  }
  const existe = await pool.query('SELECT id FROM mantenimientos_programados WHERE vehiculo_id=$1 AND tipo_mantenimiento_id=$2', [v.id, tipo_mantenimiento_id]);
  if (existe.rows[0]) {
    await pool.query('UPDATE mantenimientos_programados SET activo=true, base_fecha=COALESCE($1::date, base_fecha), base_km=CASE WHEN $1::date IS NULL THEN base_km ELSE $2::int END WHERE id=$3', [baseFecha, baseKm, existe.rows[0].id]);
  } else {
    await pool.query('INSERT INTO mantenimientos_programados (vehiculo_id,tipo_mantenimiento_id,activo,base_fecha,base_km) VALUES ($1,$2,true,$3,$4)', [v.id, tipo_mantenimiento_id, baseFecha, baseKm]);
  }
  await recalcularMantenimiento(v.id, tipo_mantenimiento_id);
  const r = await pool.query('SELECT * FROM mantenimientos_programados WHERE vehiculo_id=$1 AND tipo_mantenimiento_id=$2', [v.id, tipo_mantenimiento_id]);
  return { status: 200, fila: r.rows[0] };
}

// gastos desde que se registro el auto / km recorridos desde entonces; null si aun hay muy pocos km
async function calcularCostoPorKm(v) {
  const recorridos = v.km_actual - (v.km_inicial ?? v.km_actual);
  if (recorridos < 50) return { costo_por_km: null, km_recorridos: recorridos };
  const g = await pool.query('SELECT COALESCE(SUM(monto),0) AS total FROM gastos WHERE vehiculo_id=$1 AND fecha>=$2::date', [v.id, v.fecha_registro]);
  return { costo_por_km: Number(g.rows[0].total) / recorridos, km_recorridos: recorridos };
}

// ---------- tanque: 10 barras ----------
const BARRAS = 10;

function datosTanque(v) {
  const capacidad = Number(v.capacidad_manual ?? v.capacidad_tanque_galones) || null;
  const precio = v.precio_galon != null ? Number(v.precio_galon) : null;
  const rendimiento = Number(v.rendimiento_manual ?? v.rendimiento_km_por_galon) || null;
  const galPorBarra = capacidad ? capacidad / BARRAS : null;
  const nivel = v.nivel_combustible != null ? Number(v.nivel_combustible) : null;
  const galones = nivel != null && galPorBarra ? nivel * galPorBarra : null;
  return {
    capacidad, precio, rendimiento, galPorBarra, nivel, galones,
    costoBarra: galPorBarra && precio ? galPorBarra * precio : null,
    autonomia: galones != null && rendimiento ? galones * rendimiento : null
  };
}

function describirTanque(v) {
  const d = datosTanque(v);
  return {
    capacidad_galones: d.capacidad,
    capacidad_origen: v.capacidad_manual != null ? 'manual' : 'ia',
    galones_por_barra: d.galPorBarra,
    costo_por_barra: d.costoBarra,
    nivel: d.nivel,
    galones: d.galones,
    autonomia_km: d.autonomia,
    actualizado: v.nivel_actualizado ?? null,
    km_nivel: v.km_nivel ?? null
  };
}

// Odometro estimado: el que registro el usuario mas los km que aportan las lecturas del medidor desde entonces.
async function odometroEstimado(v) {
  const r = await pool.query(
    'SELECT COALESCE(SUM(km_estimados),0) AS extra FROM lecturas_combustible WHERE vehiculo_id=$1 AND fecha > COALESCE($2::timestamptz, to_timestamp(0))',
    [v.id, v.km_actualizado]);
  const extra = Math.round(Number(r.rows[0].extra));
  const estimado = v.km_actual + extra;
  // recorrido parcial (informativo): km desde la ultima vez que el usuario lo puso en 0, segun sus odometros y el consumo
  const base = v.parcial_km_base ?? v.km_inicial ?? v.km_actual;
  return {
    registrado: v.km_actual, extra, estimado, actualizado: v.km_actualizado ?? null,
    parcial: { km: Math.max(estimado - base, 0), desde: v.parcial_desde ?? v.fecha_registro }
  };
}

async function reiniciarRecorrido(v) {
  const { estimado } = await odometroEstimado(v);
  const up = await pool.query('UPDATE vehiculos SET parcial_km_base=$1, parcial_desde=clock_timestamp() WHERE id=$2 RETURNING *', [estimado, v.id]);
  return odometroEstimado({ ...v, ...up.rows[0] });
}

// Fija el nivel del medidor (en barras). El consumo desde la ultima lectura es: nivel anterior + lo comprado - nivel nuevo.
// Si hay consumo, estima el costo y, sin km reales, los km recorridos (que se suman al odometro estimado).
// `nivel_antes` (solo con una carga) es lo que marcaba el medidor justo antes de cargar: primero se registra ese consumo.
async function registrarNivel(v, { nivel, km, monto, nivel_antes }) {
  let d = datosTanque(v);
  if (!d.galPorBarra) return { status: 409, error: 'falta la capacidad del tanque' };
  const nuevo = Math.round(Number(nivel) * 10) / 10;
  if (!(nuevo >= 0 && nuevo <= BARRAS)) return { status: 400, error: 'nivel invalido' };
  const kmAhora = km != null && km !== '' ? Number(km) : v.km_actual;
  if (!(kmAhora >= 0 && kmAhora <= 3000000)) return { status: 400, error: 'km invalido' };
  if (kmAhora < v.km_actual) return { status: 400, error: 'el odometro no puede ser menor al actual' };
  const cargado = Number(monto) > 0 ? Number(monto) : 0;

  let previo = null;
  if (nivel_antes != null && nivel_antes !== '') {
    const antes = Math.round(Number(nivel_antes) * 10) / 10;
    if (!cargado) return { status: 400, error: 'nivel_antes solo aplica al registrar una carga' };
    if (!(antes >= 0 && antes <= BARRAS)) return { status: 400, error: 'nivel invalido' };
    if (d.nivel != null && antes < d.nivel) {
      previo = await registrarNivel(v, { nivel: antes, km });
      if (previo.error) return previo;
      v = await vehiculoDeUsuario(v.id, v.usuario_id);
      d = datosTanque(v);
    }
  }

  const prev = d.nivel;
  const comprado = cargado && d.costoBarra ? cargado / d.costoBarra : 0;
  const consumoBarras = prev != null ? prev + comprado - nuevo : 0;

  let tramo = null;
  let subio = null;
  if (prev != null && consumoBarras > (cargado ? 0.25 : 0)) {
    const galones = consumoBarras * d.galPorBarra;
    const kmRec = v.km_nivel != null && kmAhora > v.km_nivel ? kmAhora - v.km_nivel : null;
    // el rendimiento solo es creible con al menos 1 barra consumida y km conocidos
    let rendimiento = kmRec && consumoBarras >= 1 ? kmRec / galones : null;
    if (rendimiento != null && !(rendimiento >= 5 && rendimiento <= 150)) rendimiento = null;
    // sin km reales, los km recorridos se estiman con el rendimiento del auto
    const kmEstimados = kmRec == null && d.rendimiento ? galones * d.rendimiento : null;
    tramo = { barras: consumoBarras, galones, costo: d.precio ? galones * d.precio : null, km_recorridos: kmRec, rendimiento, km_estimados: kmEstimados };
  }
  if (prev != null && nuevo > prev) {
    subio = { barras: nuevo - prev, galones: (nuevo - prev) * d.galPorBarra, monto_estimado: d.costoBarra ? (nuevo - prev) * d.costoBarra : null };
  }

  let gasto = null;
  if (cargado) {
    const g = await pool.query(
      "INSERT INTO gastos (vehiculo_id,tipo,categoria,monto,descripcion,fecha,fecha_registro,km) VALUES ($1,'no_programado','Combustible',$2,'',$3,now(),$4) RETURNING *",
      [v.id, cargado, hoyLocal(), kmAhora]);
    gasto = g.rows[0];
  }
  await pool.query(
    'INSERT INTO lecturas_combustible (vehiculo_id,fecha,nivel_anterior,nivel,monto_cargado,km,km_recorridos,galones_consumidos,costo_estimado,rendimiento,km_estimados) VALUES ($1,clock_timestamp(),$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [v.id, prev, nuevo, cargado, kmAhora, tramo?.km_recorridos ?? null, tramo?.galones ?? null, tramo?.costo ?? null, tramo?.rendimiento ?? null, tramo?.km_estimados ?? 0]);
  // si el usuario dio un odometro mayor, ese valor es el real y el estimado vuelve a partir de ahi
  const up = await pool.query(
    'UPDATE vehiculos SET nivel_combustible=$1, km_nivel=$2, nivel_actualizado=now(), km_actual=GREATEST(km_actual,$2), km_actualizado=CASE WHEN $2::int > km_actual THEN clock_timestamp() ELSE km_actualizado END WHERE id=$3 RETURNING *',
    [nuevo, kmAhora, v.id]);
  const nuevoV = { ...v, ...up.rows[0] };
  return { status: 200, nivel: nuevo, tramo: tramo ?? previo?.tramo ?? null, subio, gasto, tanque: describirTanque(nuevoV), odometro: await odometroEstimado(nuevoV) };
}

// cuanto llena un monto en soles
function calcularCarga(v, monto) {
  const d = datosTanque(v);
  if (!d.precio) return { error: 'falta el precio del galon' };
  const galones = monto / d.precio;
  const barras = d.galPorBarra ? galones / d.galPorBarra : null;
  return {
    monto, galones, barras,
    km_aproximados: d.rendimiento ? galones * d.rendimiento : null,
    nivel_actual: d.nivel,
    nivel_resultante: d.nivel != null && barras != null ? Math.min(d.nivel + barras, BARRAS) : null,
    desborda: d.nivel != null && barras != null ? d.nivel + barras > BARRAS : false
  };
}

// cuanto cuesta un viaje y si alcanza con el tanque actual y con el dinero libre
async function estimarViaje(v, { km, ida_vuelta, peajes }) {
  const d = datosTanque(v);
  const distancia = Number(km);
  if (!(distancia > 0 && distancia <= 20000)) return { status: 400, error: 'distancia invalida' };
  if (!d.rendimiento || !d.precio) return { status: 409, error: 'falta el rendimiento o el precio del combustible' };
  const kmTotal = distancia * (ida_vuelta ? 2 : 1);
  const galones = kmTotal / d.rendimiento;
  const costoCombustible = galones * d.precio;
  const peajesN = Number(peajes) > 0 ? Number(peajes) : 0;
  const total = costoCombustible + peajesN;
  const conTanque = d.galones != null ? {
    alcanza: d.autonomia >= kmTotal,
    autonomia_km: d.autonomia,
    galones_a_cargar: Math.max(galones - d.galones, 0),
    monto_a_cargar: Math.max(galones - d.galones, 0) * d.precio
  } : null;
  const libre = await calcularLibre(v);
  return {
    status: 200, km_total: kmTotal, galones, barras: d.galPorBarra ? galones / d.galPorBarra : null,
    costo_combustible: costoCombustible, peajes: peajesN, total,
    con_tanque_actual: conTanque,
    veredicto: evaluarCompra(libre, total)
  };
}

// combustible: precio de referencia, rendimiento, costo por km y lo que el usuario suele pagar (ultimos 3 meses)
async function resumenCombustible(v) {
  const rendimiento = Number(v.rendimiento_manual ?? v.rendimiento_km_por_galon) || null;
  const precio = v.precio_galon != null ? Number(v.precio_galon) : null;
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const r = await pool.query(
    `SELECT COUNT(*)::int AS cargas, COALESCE(SUM(monto),0) AS total, COUNT(DISTINCT to_char(fecha,'YYYY-MM'))::int AS meses
     FROM gastos WHERE vehiculo_id=$1 AND fecha>=$2::date AND categoria ILIKE 'combustible%'`, [v.id, desde]);
  const { cargas, total, meses } = r.rows[0];
  const promedioMensual = meses ? Number(total) / meses : null;
  const promedioCarga = cargas ? Number(total) / cargas : null;
  const lect = await pool.query(
    'SELECT km_recorridos, galones_consumidos FROM lecturas_combustible WHERE vehiculo_id=$1 AND rendimiento IS NOT NULL ORDER BY fecha DESC LIMIT 5', [v.id]);
  const kmTramos = lect.rows.reduce((t, x) => t + Number(x.km_recorridos), 0);
  const galTramos = lect.rows.reduce((t, x) => t + Number(x.galones_consumidos), 0);
  const rendimientoReal = galTramos > 0 ? { valor: kmTramos / galTramos, tramos: lect.rows.length } : null;
  return {
    tanque: describirTanque(v),
    rendimiento_real: rendimientoReal,
    grado: v.combustible_grado,
    precio_galon: precio,
    rendimiento_km_por_galon: rendimiento,
    rendimiento_origen: v.rendimiento_manual != null ? 'manual' : 'ia',
    costo_por_km: precio && rendimiento ? precio / rendimiento : null,
    promedio_mensual: promedioMensual,
    promedio_por_carga: promedioCarga,
    km_por_carga: promedioCarga && precio && rendimiento ? (promedioCarga / precio) * rendimiento : null,
    cargas
  };
}

// los argumentos de las tools los genera el modelo: solo se aceptan fechas YYYY-MM o YYYY-MM-DD, lo demas se ignora
function fechaValida(x) {
  return typeof x === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(x) && !isNaN(new Date(x.length === 7 ? x + '-01' : x)) ? (x.length === 7 ? x + '-01' : x) : null;
}

async function obtenerPresupuesto(vehiculoId, args) {
  const mes = (fechaValida(args.mes) || mesActual()).slice(0, 7) + '-01';
  const p = await pool.query('SELECT * FROM presupuestos WHERE vehiculo_id=$1 AND mes=$2', [vehiculoId, mes]);
  const g = await pool.query("SELECT COALESCE(SUM(monto),0) as total FROM gastos WHERE vehiculo_id=$1 AND to_char(fecha,'YYYY-MM')=to_char($2::date,'YYYY-MM')", [vehiculoId, mes]);
  return { asignado: p.rows[0]?.monto_asignado || 0, gastado: g.rows[0].total };
}

const IMPREVISTOS_PCT = 0.1;

function diasHasta(fecha) {
  if (!fecha) return null;
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
}

// Cuanto puede gastar en gustos este mes: lo disponible menos lo que ya se sabe que viene
// (combustible que falta, mantenimientos del mes y un colchon de imprevistos).
async function calcularLibre(v) {
  const mes = mesActual();
  const pres = await obtenerPresupuesto(v.id, { mes });
  const asignado = Number(pres.asignado);
  const gastado = Number(pres.gastado);
  const disponible = asignado - gastado;

  const comb = await pool.query(
    `SELECT COALESCE(SUM(monto),0) AS total FROM gastos
     WHERE vehiculo_id=$1 AND categoria ILIKE 'combustible%' AND to_char(fecha,'YYYY-MM')=to_char($2::date,'YYYY-MM')`, [v.id, mes]);
  const combustibleGastado = Number(comb.rows[0].total);

  // lo que suele gastar al mes: el monto que declaro, o el promedio de los 3 meses completos anteriores
  let base = null;
  let origen = 'sin-datos';
  if (v.combustible_mensual != null) {
    base = Number(v.combustible_mensual);
    origen = 'declarado';
  } else {
    const h = await pool.query(
      `SELECT COALESCE(SUM(monto),0) AS total, COUNT(DISTINCT to_char(fecha,'YYYY-MM'))::int AS meses FROM gastos
       WHERE vehiculo_id=$1 AND categoria ILIKE 'combustible%' AND fecha >= ($2::date - interval '3 months') AND fecha < $2::date`, [v.id, mes]);
    if (h.rows[0].meses) {
      base = Number(h.rows[0].total) / h.rows[0].meses;
      origen = 'historial';
    }
  }
  const combustiblePendiente = base != null ? Math.max(base - combustibleGastado, 0) : 0;

  // mantenimientos que vencen este mes (o ya vencidos), con lo que costo la ultima vez
  const hoy = new Date();
  const finMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const m = await pool.query(
    `SELECT tm.nombre,
       (SELECT g.monto FROM gastos g WHERE g.vehiculo_id=mp.vehiculo_id AND g.tipo_mantenimiento_id=mp.tipo_mantenimiento_id
        ORDER BY g.fecha DESC, g.id DESC LIMIT 1) AS ultimo_costo
     FROM mantenimientos_programados mp JOIN tipos_mantenimiento tm ON tm.id=mp.tipo_mantenimiento_id
     WHERE mp.vehiculo_id=$1 AND mp.activo=true AND mp.proxima_fecha IS NOT NULL AND mp.proxima_fecha <= $2::date`, [v.id, finMes]);
  const mantenimientos = m.rows.map((r) => ({ nombre: r.nombre, costo_estimado: Number(r.ultimo_costo ?? 0), estimado: r.ultimo_costo != null }));
  const mantenimientosTotal = mantenimientos.reduce((t, x) => t + x.costo_estimado, 0);

  const imprevistos = asignado * IMPREVISTOS_PCT;
  return {
    definido: asignado > 0,
    asignado, gastado, disponible,
    combustible_base: base,
    combustible_origen: origen,
    combustible_gastado: combustibleGastado,
    combustible_pendiente: combustiblePendiente,
    mantenimientos,
    mantenimientos_total: mantenimientosTotal,
    imprevistos,
    libre: disponible - combustiblePendiente - mantenimientosTotal - imprevistos
  };
}

// veredicto determinista: no depende de la IA
function evaluarCompra(l, monto) {
  if (!l.definido) return { veredicto: 'sin-presupuesto', monto };
  if (monto <= l.libre) return { veredicto: 'si', monto, sobra: l.libre - monto };
  if (monto <= l.disponible && monto <= l.libre + l.imprevistos) return { veredicto: 'justo', monto, usa_colchon: monto - Math.max(l.libre, 0) };
  return { veredicto: 'no', monto, faltan: monto - l.libre };
}

// hechos del dia, calculados con reglas fijas; la IA solo los redacta
async function hechosCopiloto(v) {
  const l = await calcularLibre(v);
  const alertas = [];
  const mants = await obtenerMantenimientosPendientes(v.id);
  const odo = await odometroEstimado(v);
  for (const mt of mants) {
    const dias = diasHasta(mt.proxima_fecha);
    const kmRest = mt.proximo_km != null ? mt.proximo_km - odo.estimado : null;
    if ((dias != null && dias < 0) || (kmRest != null && kmRest <= 0)) alertas.push({ nivel: 'alto', texto: `${mt.nombre} esta vencido.` });
    else if (dias === 0) alertas.push({ nivel: 'alto', texto: `${mt.nombre} vence hoy.` });
    else if (dias != null && dias <= 30) alertas.push({ nivel: 'medio', texto: `${mt.nombre} vence en ${dias} dias.` });
    else if (kmRest != null && kmRest <= 500) alertas.push({ nivel: 'medio', texto: `${mt.nombre} toca en ${kmRest} km${odo.extra ? ' (estimado)' : ''}.` });
  }
  const sol = (n) => `S/ ${Math.round(n)}`;
  if (!l.definido) alertas.push({ nivel: 'info', texto: 'Aun no define su presupuesto de este mes.' });
  else if (l.disponible < 0) alertas.push({ nivel: 'alto', texto: `Se paso del presupuesto por ${sol(-l.disponible)}.` });
  else if (l.libre <= 0) alertas.push({ nivel: 'medio', texto: `Le quedan ${sol(l.disponible)} del presupuesto pero ya estan comprometidos (combustible ${sol(l.combustible_pendiente)}, mantenimientos ${sol(l.mantenimientos_total)} e imprevistos ${sol(l.imprevistos)}): no hay margen para gustos.` });
  else alertas.push({ nivel: 'ok', texto: `Tiene ${sol(l.libre)} libres para gustos este mes, despues de reservar combustible, mantenimientos e imprevistos.` });
  const tq = datosTanque(v);
  if (tq.nivel != null && tq.nivel <= 2) alertas.push({ nivel: 'medio', texto: `Su tanque marca ${tq.nivel} de ${BARRAS} barras${tq.autonomia ? ` (unos ${Math.round(tq.autonomia)} km)` : ''}.` });
  if (!v.combustible_grado || v.precio_galon == null) alertas.push({ nivel: 'info', texto: 'Falta elegir su combustible para calcular el costo por km.' });
  if (l.definido && l.combustible_origen === 'sin-datos') alertas.push({ nivel: 'info', texto: 'No se sabe cuanto suele gastar en combustible al mes; con ese dato el margen seria mas preciso.' });
  if (!mants.length) alertas.push({ nivel: 'info', texto: 'No sigue ningun mantenimiento (SOAT, aceite, etc.).' });
  const orden = { alto: 0, medio: 1, ok: 2, info: 3 };
  alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return { alertas, textoReglas: alertas.slice(0, 3).map((a) => a.texto).join(' ') };
}

async function redactarConsejo(alertas) {
  const hechos = alertas.slice(0, 4).map((a) => `- ${a.texto}`).join('\n');
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.MISTRAL_CHAT_MODEL || 'mistral-small-latest',
      max_tokens: 160,
      messages: [
        { role: 'system', content: 'Eres el mecanico y amigo del usuario. Con los hechos dados escribe un aviso de MAXIMO 2 frases cortas (40 palabras), cercano y directo, en segunda persona. Usa SOLO esos hechos: no agregues cifras, plazos, multas, leyes ni consejos que no esten escritos. Montos como S/ 50. Texto plano, sin asteriscos, emojis ni saludos.' },
        { role: 'user', content: hechos }
      ]
    })
  });
  const data = await r.json();
  const crudo = data.choices?.[0]?.message?.content?.trim();
  if (!r.ok || !crudo) throw new Error(`Mistral ${r.status}`);
  const texto = crudo.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
  // la IA solo redacta: si agrega cifras que no estaban en los hechos o habla de multas/leyes, se descarta
  const normal = (n) => String(Number(n.replace(',', '.')));
  const permitidas = new Set((hechos.match(/\d+(?:[.,]\d+)?/g) || []).map(normal));
  const sobran = (texto.match(/\d+(?:[.,]\d+)?/g) || []).filter((n) => !permitidas.has(normal(n)));
  if (sobran.length) throw new Error(`la IA agrego cifras inventadas: ${sobran.join(', ')}`);
  if (/\bmult\w*|sanci|\bley(es)?\b|legal|polic[ií]a|infracci|castig|penal/i.test(texto)) throw new Error('la IA agrego contenido legal que no estaba en los hechos');
  return texto;
}

async function obtenerMantenimientosPendientes(vehiculoId) {
  const r = await pool.query(
    `SELECT mp.*, tm.nombre FROM mantenimientos_programados mp JOIN tipos_mantenimiento tm ON tm.id=mp.tipo_mantenimiento_id
     WHERE mp.vehiculo_id=$1 AND mp.activo=true ORDER BY mp.proxima_fecha ASC NULLS LAST`, [vehiculoId]);
  return r.rows;
}

async function obtenerHistorialGastos(vehiculoId, args) {
  let q = 'SELECT * FROM gastos WHERE vehiculo_id=$1';
  const params = [vehiculoId]; let i = 2;
  const desde = fechaValida(args.desde);
  const hasta = fechaValida(args.hasta);
  if (desde) { q += ` AND fecha>=$${i++}`; params.push(desde); }
  if (hasta) { q += ` AND fecha<=$${i++}`; params.push(hasta); }
  if (typeof args.categoria === 'string' && args.categoria) { q += ` AND categoria ILIKE $${i++}`; params.push(args.categoria); }
  q += ' ORDER BY fecha DESC LIMIT 50';
  const r = await pool.query(q, params);
  return r.rows;
}

async function ejecutarTool(nombre, args, v) {
  const vehiculoId = v.id;
  if (nombre === 'obtener_presupuesto') return obtenerPresupuesto(vehiculoId, args);
  if (nombre === 'obtener_mantenimientos_pendientes') return obtenerMantenimientosPendientes(vehiculoId);
  if (nombre === 'obtener_historial_gastos') return obtenerHistorialGastos(vehiculoId, args);
  if (nombre === 'calcular_costo_por_km') {
    const real = await calcularCostoPorKm(v);
    const comb = await resumenCombustible(v);
    return { costo_real_por_km: real.costo_por_km, km_recorridos_desde_registro: real.km_recorridos, costo_combustible_por_km: comb.costo_por_km };
  }
  if (nombre === 'obtener_combustible') return resumenCombustible(v);
  if (nombre === 'obtener_odometro') return odometroEstimado(v);
  if (nombre === 'obtener_notas') {
    const r = await pool.query('SELECT texto, fecha FROM notas WHERE vehiculo_id=$1 ORDER BY fecha DESC LIMIT 10', [vehiculoId]);
    return r.rows;
  }
  if (nombre === 'calcular_carga') {
    const monto = Number(args.monto);
    return monto > 0 ? calcularCarga(v, monto) : { error: 'falta el monto en soles' };
  }
  if (nombre === 'estimar_viaje') {
    const r = await estimarViaje(v, { km: args.km, ida_vuelta: args.ida_vuelta === true, peajes: args.peajes });
    return r.error ? { error: r.error } : r;
  }
  if (nombre === 'evaluar_compra') {
    const l = await calcularLibre(v);
    const monto = Number(args.monto);
    return monto > 0 ? { descripcion: typeof args.descripcion === 'string' ? args.descripcion : null, ...evaluarCompra(l, monto), desglose: l } : { desglose: l };
  }
  return { error: 'tool no encontrada' };
}

const toolsDefs = [
  { type: 'function', function: { name: 'obtener_odometro', description: 'Odometro registrado, odometro estimado por el consumo de combustible y el recorrido parcial (km desde la ultima vez que el usuario lo puso en 0)', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'obtener_notas', description: 'Notas que el dueño anoto sobre su auto (ruidos, observaciones, recordatorios), las mas recientes primero', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'calcular_carga', description: 'Cuantas barras del medidor (de 10), galones y km se obtienen con un monto en soles de combustible, y en que nivel quedaria el tanque', parameters: { type: 'object', properties: { monto: { type: 'number', description: 'Monto en soles que se cargaria' } }, required: ['monto'] } } },
  { type: 'function', function: { name: 'estimar_viaje', description: 'Costo estimado de combustible de un viaje, si alcanza con el tanque actual, cuanto cargar antes de salir y si el dinero libre lo permite', parameters: { type: 'object', properties: { km: { type: 'number', description: 'Distancia en km de solo ida' }, ida_vuelta: { type: 'boolean', description: 'true si tambien volvera' }, peajes: { type: 'number', description: 'Soles estimados de peajes (opcional)' } }, required: ['km'] } } },
  { type: 'function', function: { name: 'evaluar_compra', description: 'Dice si el usuario puede permitirse un gasto o compra (adorno, accesorio, reparacion opcional...). Descuenta del presupuesto lo que aun necesita para combustible, mantenimientos del mes e imprevistos. Devuelve veredicto si / justo / no y el desglose', parameters: { type: 'object', properties: { monto: { type: 'number', description: 'Costo en soles de lo que quiere comprar' }, descripcion: { type: 'string', description: 'Que quiere comprar' } }, required: ['monto'] } } },
  { type: 'function', function: { name: 'obtener_presupuesto', description: 'Presupuesto asignado y gastado de un mes. Sin argumentos devuelve el mes actual', parameters: { type: 'object', properties: { mes: { type: 'string', description: 'Opcional. Formato YYYY-MM, por ejemplo 2026-09. Omitir para el mes actual' } }, required: [] } } },
  { type: 'function', function: { name: 'obtener_mantenimientos_pendientes', description: 'Mantenimientos activos con proxima fecha o km', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'obtener_historial_gastos', description: 'Gastos filtrados por fecha o categoria', parameters: { type: 'object', properties: { desde: { type: 'string', description: 'Opcional. Formato YYYY-MM-DD' }, hasta: { type: 'string', description: 'Opcional. Formato YYYY-MM-DD' }, categoria: { type: 'string', description: 'Opcional. Ej. Combustible' } }, required: [] } } },
  { type: 'function', function: { name: 'obtener_combustible', description: 'Combustible del auto: grado, precio por galon, rendimiento km/galon, costo de combustible por km, y lo que el usuario suele gastar por carga y por mes', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'calcular_costo_por_km', description: 'Costo real por kilometro recorrido desde que se registro el auto (null si aun hay pocos km) y costo estimado solo de combustible', parameters: { type: 'object', properties: {}, required: [] } } }
];

// estado del servicio y de la base de datos (para comprobar el despliegue)
app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

// valida el id_token de Google, crea o recupera el usuario y devuelve un JWT propio
app.post('/auth/google', async (req, res) => {
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    let r = await pool.query('SELECT * FROM usuarios WHERE google_id=$1', [payload.sub]);
    let usuario = r.rows[0];
    if (!usuario) {
      const ins = await pool.query('INSERT INTO usuarios (google_id,nombre,email,foto_url) VALUES ($1,$2,$3,$4) RETURNING *',
        [payload.sub, payload.name, payload.email, payload.picture]);
      usuario = ins.rows[0];
    }
    const token = jwt.sign({ usuarioId: usuario.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, usuario });
  } catch (e) { res.status(401).json({ error: 'login fallido' }); }
});

// no requiere accion en servidor, el frontend borra el token de localStorage
app.post('/auth/logout', (req, res) => res.json({ ok: true }));

// registra un vehiculo; si no hay specs en cache, las obtiene con la IA y las guarda
app.post('/vehiculos', auth, async (req, res) => {
  try {
    const { marca, modelo, anio, placa, combustible_grado } = req.body;
    let esp = await pool.query('SELECT * FROM especificaciones_vehiculo WHERE marca=$1 AND modelo=$2 AND anio=$3', [marca, modelo, anio]);
    let especificacion = esp.rows[0];
    if (especificacion && especificacion.rendimiento_km_por_galon == null) {
      const datos = await buscarSpecsVehiculo(marca, modelo, anio);
      const upd = await pool.query(
        'UPDATE especificaciones_vehiculo SET tipo_combustible=$1, rendimiento_km_por_galon=$2, capacidad_tanque_galones=$3, fecha_consulta=now() WHERE id=$4 RETURNING *',
        [datos.tipo_combustible, datos.rendimiento_km_por_galon, datos.capacidad_tanque_galones, especificacion.id]);
      especificacion = upd.rows[0];
    }
    if (!especificacion) {
      const datos = await buscarSpecsVehiculo(marca, modelo, anio);
      const ins = await pool.query(
        'INSERT INTO especificaciones_vehiculo (marca,modelo,anio,tipo_combustible,rendimiento_km_por_galon,capacidad_tanque_galones,fuente,fecha_consulta) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *',
        [marca, modelo, anio, datos.tipo_combustible, datos.rendimiento_km_por_galon, datos.capacidad_tanque_galones, 'IA-busqueda-web']);
      especificacion = ins.rows[0];
    }
    const grado = GRADOS.includes(combustible_grado) ? combustible_grado : null;
    const precio = await precioReferencia(grado);
    const veh = await pool.query('INSERT INTO vehiculos (usuario_id,especificacion_id,placa,km_actual,combustible_grado,precio_galon) VALUES ($1,$2,$3,0,$4,$5) RETURNING *',
      [req.usuarioId, especificacion.id, placa, grado, precio]);
    res.json({ ...veh.rows[0], especificacion });
  } catch (e) { res.status(500).json({ error: 'no se pudo registrar el vehiculo' }); }
});

// lista los vehiculos del usuario con sus specs
app.get('/vehiculos', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT v.*, e.marca,e.modelo,e.anio,e.tipo_combustible,e.rendimiento_km_por_galon,e.capacidad_tanque_galones
     FROM vehiculos v JOIN especificaciones_vehiculo e ON e.id=v.especificacion_id WHERE v.usuario_id=$1`, [req.usuarioId]);
  res.json(r.rows);
});

// detalle de un vehiculo con sus specs
app.get('/vehiculos/:id', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  res.json(v);
});

// actualiza km, placa y datos de combustible (grado, rendimiento corregido, precio por galon)
app.patch('/vehiculos/:id', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const b = req.body;
  const numero = (x, min, max) => { const n = Number(x); return Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
  const km = b.km_actual ?? v.km_actual;
  const placa = b.placa ?? v.placa;
  // la primera vez que se registra un odometro queda como punto de partida del costo por km
  const kmInicial = v.km_inicial ?? (km > 0 ? km : null);
  let grado = v.combustible_grado;
  let precio = v.precio_galon;
  let rendimiento = v.rendimiento_manual;
  let mensual = v.combustible_mensual;
  let capacidad = v.capacidad_manual;

  if (b.combustible_grado !== undefined) {
    if (!GRADOS.includes(b.combustible_grado)) return res.status(400).json({ error: 'combustible invalido' });
    if (b.combustible_grado !== grado) {
      grado = b.combustible_grado;
      precio = await precioReferencia(grado);
    }
  }
  if (b.precio_galon !== undefined) {
    // null = volver al precio de referencia
    if (b.precio_galon === null) precio = await precioReferencia(grado);
    else if ((precio = numero(b.precio_galon, 1, 100)) === undefined) return res.status(400).json({ error: 'precio invalido' });
  }
  if (b.rendimiento_manual !== undefined) {
    if (b.rendimiento_manual === null) rendimiento = null;
    else if ((rendimiento = numero(b.rendimiento_manual, 1, 200)) === undefined) return res.status(400).json({ error: 'rendimiento invalido' });
  }

  if (b.combustible_mensual !== undefined) {
    if (b.combustible_mensual === null) mensual = null;
    else if ((mensual = numero(b.combustible_mensual, 0, 100000)) === undefined) return res.status(400).json({ error: 'monto invalido' });
  }

  if (b.capacidad_manual !== undefined) {
    if (b.capacidad_manual === null) capacidad = null;
    else if ((capacidad = numero(b.capacidad_manual, 1, 300)) === undefined) return res.status(400).json({ error: 'capacidad invalida' });
  }

  const r = await pool.query(
    'UPDATE vehiculos SET km_actual=$1, placa=$2, km_inicial=$3, combustible_grado=$4, precio_galon=$5, rendimiento_manual=$6, combustible_mensual=$7, capacidad_manual=$8, km_actualizado=CASE WHEN $10::boolean THEN clock_timestamp() ELSE km_actualizado END WHERE id=$9 RETURNING *',
    [km, placa, kmInicial, grado, precio, rendimiento, mensual, capacidad, v.id, b.km_actual !== undefined]);
  res.json(r.rows[0]);
});

// lista el catalogo de tipos de mantenimiento
app.get('/tipos-mantenimiento', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM tipos_mantenimiento ORDER BY id');
  res.json(r.rows);
});

// activa el seguimiento de un tipo de mantenimiento para el vehiculo
app.post('/vehiculos/:id/mantenimientos', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const { status, ...r } = await seguirMantenimiento(v, req.body);
  if (r.error) return res.status(status).json({ error: r.error });
  res.json(r.fila);
});

// lista los mantenimientos activos del vehiculo ordenados por proximidad
app.get('/vehiculos/:id/mantenimientos', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  res.json(await obtenerMantenimientosPendientes(v.id));
});

// corrige manualmente fecha o km de un mantenimiento
app.patch('/mantenimientos/:id', auth, async (req, res) => {
  const chk = await pool.query('SELECT mp.* FROM mantenimientos_programados mp JOIN vehiculos v ON v.id=mp.vehiculo_id WHERE mp.id=$1 AND v.usuario_id=$2', [req.params.id, req.usuarioId]);
  if (!chk.rows[0]) return res.status(404).json({ error: 'no encontrado' });
  const a = chk.rows[0];
  const b = req.body;
  const r = await pool.query('UPDATE mantenimientos_programados SET ultima_fecha=$1,ultimo_km=$2,proxima_fecha=$3,proximo_km=$4 WHERE id=$5 RETURNING *',
    [b.ultima_fecha ?? a.ultima_fecha, b.ultimo_km ?? a.ultimo_km, b.proxima_fecha ?? a.proxima_fecha, b.proximo_km ?? a.proximo_km, req.params.id]);
  res.json(r.rows[0]);
});

// desactiva el seguimiento de un mantenimiento
app.delete('/mantenimientos/:id', auth, async (req, res) => {
  const chk = await pool.query('SELECT mp.id FROM mantenimientos_programados mp JOIN vehiculos v ON v.id=mp.vehiculo_id WHERE mp.id=$1 AND v.usuario_id=$2', [req.params.id, req.usuarioId]);
  if (!chk.rows[0]) return res.status(404).json({ error: 'no encontrado' });
  await pool.query('UPDATE mantenimientos_programados SET activo=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// crea o actualiza el presupuesto mensual del vehiculo
app.post('/vehiculos/:id/presupuesto', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const { mes, monto_asignado } = req.body;
  const existe = await pool.query('SELECT id FROM presupuestos WHERE vehiculo_id=$1 AND mes=$2', [v.id, mes]);
  if (existe.rows[0]) {
    const r = await pool.query('UPDATE presupuestos SET monto_asignado=$1, fecha_actualizacion=now() WHERE id=$2 RETURNING *', [monto_asignado, existe.rows[0].id]);
    return res.json(r.rows[0]);
  }
  const r = await pool.query('INSERT INTO presupuestos (vehiculo_id,mes,monto_asignado,fecha_actualizacion) VALUES ($1,$2,$3,now()) RETURNING *', [v.id, mes, monto_asignado]);
  res.json(r.rows[0]);
});

// devuelve el presupuesto del mes y lo gastado hasta ahora
app.get('/vehiculos/:id/presupuesto', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  res.json(await obtenerPresupuesto(v.id, { mes: req.query.mes }));
});

// registra un gasto y, si corresponde a un mantenimiento, actualiza su seguimiento
app.post('/vehiculos/:id/gastos', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const { tipo, categoria, monto, descripcion, fecha, tipo_mantenimiento_id, km } = req.body;
  const manana = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || sumarMeses(fecha, 0) !== fecha) return res.status(400).json({ error: 'fecha invalida' });
  if (fecha > manana) return res.status(400).json({ error: 'la fecha no puede ser futura' });
  // km del auto cuando ocurrio el gasto; si no lo mandan y la fecha es reciente, se asume el odometro actual
  let kmServicio = km != null && km !== '' ? Number(km) : null;
  if (kmServicio != null && !(kmServicio >= 0 && kmServicio <= 3000000)) return res.status(400).json({ error: 'km invalido' });
  if (kmServicio == null && Math.abs(diasHasta(fecha)) <= 7) kmServicio = v.km_actual;
  const r = await pool.query(
    'INSERT INTO gastos (vehiculo_id,tipo_mantenimiento_id,tipo,categoria,monto,descripcion,fecha,fecha_registro,km) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8) RETURNING *',
    [v.id, tipo_mantenimiento_id || null, tipo, categoria, monto, descripcion, fecha, kmServicio]);
  if (tipo_mantenimiento_id) await recalcularMantenimiento(v.id, tipo_mantenimiento_id);
  // el odometro solo avanza: un servicio antiguo nunca lo retrocede
  if (kmServicio != null && kmServicio > v.km_actual) {
    await pool.query('UPDATE vehiculos SET km_actual=$1, km_inicial=COALESCE(km_inicial,$1), km_actualizado=clock_timestamp() WHERE id=$2', [kmServicio, v.id]);
  }
  res.json(r.rows[0]);
});

// lista los gastos del vehiculo con filtros opcionales
app.get('/vehiculos/:id/gastos', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  res.json(await obtenerHistorialGastos(v.id, req.query));
});

// elimina un gasto registrado por error
app.delete('/gastos/:id', auth, async (req, res) => {
  const chk = await pool.query('SELECT g.id, g.vehiculo_id, g.tipo_mantenimiento_id FROM gastos g JOIN vehiculos v ON v.id=g.vehiculo_id WHERE g.id=$1 AND v.usuario_id=$2', [req.params.id, req.usuarioId]);
  if (!chk.rows[0]) return res.status(404).json({ error: 'no encontrado' });
  await pool.query('DELETE FROM gastos WHERE id=$1', [req.params.id]);
  if (chk.rows[0].tipo_mantenimiento_id) await recalcularMantenimiento(chk.rows[0].vehiculo_id, chk.rows[0].tipo_mantenimiento_id);
  res.json({ ok: true });
});

// agrega presupuesto, gastos por categoria, proximos mantenimientos y costo por km
app.get('/vehiculos/:id/dashboard', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const mes = mesActual();
  const presupuesto = await obtenerPresupuesto(v.id, { mes });
  const porCategoria = await pool.query(
    "SELECT categoria, SUM(monto) as total FROM gastos WHERE vehiculo_id=$1 AND to_char(fecha,'YYYY-MM')=to_char($2::date,'YYYY-MM') GROUP BY categoria", [v.id, mes]);
  const mantenimientos = await pool.query(
    `SELECT mp.*, tm.nombre FROM mantenimientos_programados mp JOIN tipos_mantenimiento tm ON tm.id=mp.tipo_mantenimiento_id
     WHERE mp.vehiculo_id=$1 AND mp.activo=true ORDER BY mp.proxima_fecha ASC NULLS LAST LIMIT 5`, [v.id]);
  const costo = await calcularCostoPorKm(v);
  const combustible = await resumenCombustible(v);
  const libre = await calcularLibre(v);
  res.json({ presupuesto, gastos_por_categoria: porCategoria.rows, proximos_mantenimientos: mantenimientos.rows, costo_por_km: costo.costo_por_km, combustible, libre, odometro: await odometroEstimado(v) });
});

// fija el nivel del medidor de combustible (barras); opcionalmente registra la carga como gasto
app.put('/vehiculos/:id/nivel-combustible', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const { status, ...r } = await registrarNivel(v, req.body);
  if (r.error) return res.status(status).json({ error: r.error });
  res.json(r);
});

// cuanto llena un monto y cuanto cuesta un viaje (sin IA)
app.post('/vehiculos/:id/calcular-carga', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const monto = Number(req.body.monto);
  if (!(monto > 0 && monto <= 100000)) return res.status(400).json({ error: 'monto invalido' });
  const r = calcularCarga(v, monto);
  if (r.error) return res.status(409).json({ error: r.error });
  res.json(r);
});

app.post('/vehiculos/:id/estimar-viaje', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const { status, ...r } = await estimarViaje(v, req.body);
  if (r.error) return res.status(status).json({ error: r.error });
  res.json(r);
});

// ---------- notas libres sobre el auto ----------
function textoNota(x) {
  const t = typeof x === 'string' ? x.trim() : '';
  return t.length >= 1 && t.length <= 1000 ? t : null;
}

app.get('/vehiculos/:id/notas', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const r = await pool.query('SELECT * FROM notas WHERE vehiculo_id=$1 ORDER BY fecha DESC, id DESC LIMIT 100', [v.id]);
  res.json(r.rows);
});

app.post('/vehiculos/:id/notas', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const texto = textoNota(req.body.texto);
  if (!texto) return res.status(400).json({ error: 'la nota debe tener entre 1 y 1000 caracteres' });
  const r = await pool.query('INSERT INTO notas (vehiculo_id,texto) VALUES ($1,$2) RETURNING *', [v.id, texto]);
  res.json(r.rows[0]);
});

app.patch('/notas/:id', auth, async (req, res) => {
  const texto = textoNota(req.body.texto);
  if (!texto) return res.status(400).json({ error: 'la nota debe tener entre 1 y 1000 caracteres' });
  const r = await pool.query(
    'UPDATE notas n SET texto=$1, actualizada=now() FROM vehiculos v WHERE n.id=$2 AND v.id=n.vehiculo_id AND v.usuario_id=$3 RETURNING n.*',
    [texto, req.params.id, req.usuarioId]);
  if (!r.rows[0]) return res.status(404).json({ error: 'no encontrado' });
  res.json(r.rows[0]);
});

app.delete('/notas/:id', auth, async (req, res) => {
  const r = await pool.query('DELETE FROM notas n USING vehiculos v WHERE n.id=$1 AND v.id=n.vehiculo_id AND v.usuario_id=$2 RETURNING n.id', [req.params.id, req.usuarioId]);
  if (!r.rows[0]) return res.status(404).json({ error: 'no encontrado' });
  res.json({ ok: true });
});

// pone en 0 el recorrido parcial (solo informativo; no afecta alertas ni gastos)
app.post('/vehiculos/:id/recorrido/reiniciar', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  res.json(await reiniciarRecorrido(v));
});

// veredicto instantaneo "me alcanza?" (sin IA)
app.post('/vehiculos/:id/me-alcanza', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const monto = Number(req.body.monto);
  if (!(monto > 0 && monto <= 10000000)) return res.status(400).json({ error: 'monto invalido' });
  const libre = await calcularLibre(v);
  res.json({ ...evaluarCompra(libre, monto), libre });
});

// aviso del dia: hechos por reglas, redactado por la IA y guardado por dia; si la IA falla, texto de reglas
app.get('/vehiculos/:id/copiloto', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const { alertas, textoReglas } = await hechosCopiloto(v);
  const hash = crypto.createHash('sha1').update(JSON.stringify(alertas)).digest('hex');
  const hoy = new Date().toLocaleDateString('en-CA');
  const c = await pool.query('SELECT hash, texto FROM consejos_diarios WHERE vehiculo_id=$1 AND fecha=$2', [v.id, hoy]);
  if (c.rows[0]?.hash === hash) return res.json({ texto: c.rows[0].texto, fuente: 'ia', alertas });
  try {
    const texto = await redactarConsejo(alertas);
    await pool.query(
      'INSERT INTO consejos_diarios (vehiculo_id,fecha,hash,texto) VALUES ($1,$2,$3,$4) ON CONFLICT (vehiculo_id,fecha) DO UPDATE SET hash=EXCLUDED.hash, texto=EXCLUDED.texto',
      [v.id, hoy, hash, texto]);
    return res.json({ texto, fuente: 'ia', alertas });
  } catch (e) {
    console.error('copiloto sin IA:', e.message);
    res.json({ texto: textoReglas, fuente: 'reglas', alertas });
  }
});

// chat con la IA: usa tools de lectura sobre la DB del vehiculo, sin memoria entre sesiones
app.post('/vehiculos/:id/chat', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  let mensajes = [
    { role: 'system', content: `Eres el mecanico y amigo personal del usuario para su vehiculo. Responde corto y cercano, usa las tools para datos reales, nunca inventes cifras. Hoy es ${new Date().toLocaleDateString('en-CA')} (el mes actual es ${mesActual().slice(0, 7)}). Todos los montos estan en soles peruanos: escribelos como S/ 50, nunca con $. El "disponible" del presupuesto NO es dinero libre: parte ya esta comprometida en combustible, mantenimientos e imprevistos. Si el usuario pregunta si puede comprar, pagar o gastar algo, SIEMPRE llama a evaluar_compra con el monto y responde con un veredicto claro (si / justo / no) citando cuanto tiene libre y que falta reservar. Si no dijo el monto, preguntale cuanto cuesta.` },
    { role: 'user', content: req.body.mensaje }
  ];
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.MISTRAL_CHAT_MODEL || 'mistral-small-latest', messages: mensajes, tools: toolsDefs, tool_choice: 'auto' })
    });
    const data = await r.json();
    if (!data.choices?.length) {
      console.error('Mistral chat sin respuesta:', r.status, JSON.stringify(data).slice(0, 600));
      return res.status(r.status === 429 ? 429 : 502).json({ error: 'la IA no respondio' });
    }
    const msg = data.choices[0].message;
    if (!msg.tool_calls) return res.json({ respuesta: msg.content });
    mensajes.push(msg);
    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments || '{}');
      const resultado = await ejecutarTool(tc.function.name, args, v);
      mensajes.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(resultado) });
    }
  }
  res.json({ respuesta: 'no se pudo procesar la consulta' });
});

app.listen(process.env.PORT || 3000);
