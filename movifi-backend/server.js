const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

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
    `SELECT v.*, e.marca, e.modelo, e.anio, e.tipo_combustible, e.rendimiento_km_por_galon
     FROM vehiculos v JOIN especificaciones_vehiculo e ON e.id = v.especificacion_id
     WHERE v.id=$1 AND v.usuario_id=$2`, [id, usuarioId]);
  return r.rows[0];
}

function mesActual() {
  return new Date().toISOString().slice(0, 7) + '-01';
}

function sumarMeses(fecha, meses) {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function textoDeConversacion(data) {
  const outputs = data.outputs || [];
  for (const o of outputs) {
    if (o.type === 'message.output' && Array.isArray(o.content)) {
      for (const c of o.content) if (c.type === 'text' && c.text) return c.text;
    }
  }
  return JSON.stringify(data);
}

async function buscarSpecsVehiculo(marca, modelo, anio) {
  const r = await fetch('https://api.mistral.ai/v1/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      instructions: 'Busca specs oficiales de vehiculos. Responde solo JSON valido, sin texto extra.',
      tools: [{ type: 'web_search' }],
      inputs: `Busca specs del ${marca} ${modelo} ${anio}: tipo de combustible, rendimiento en km por galon, capacidad de tanque en galones. Responde solo: {"tipo_combustible":"","rendimiento_km_por_galon":0,"capacidad_tanque_galones":0}`
    })
  });
  const data = await r.json();
  const texto = textoDeConversacion(data).replace(/```json|```/g, '').trim();
  return JSON.parse(texto);
}

async function actualizarMantenimiento(vehiculoId, tipoMantId, fecha, kmActual) {
  const tipoRes = await pool.query('SELECT * FROM tipos_mantenimiento WHERE id=$1', [tipoMantId]);
  const tipo = tipoRes.rows[0];
  if (!tipo) return;
  const proximaFecha = tipo.frecuencia_meses_sugerida ? sumarMeses(fecha, tipo.frecuencia_meses_sugerida) : null;
  const proximoKm = tipo.frecuencia_km_sugerida ? (kmActual || 0) + tipo.frecuencia_km_sugerida : null;
  const existe = await pool.query('SELECT id FROM mantenimientos_programados WHERE vehiculo_id=$1 AND tipo_mantenimiento_id=$2', [vehiculoId, tipoMantId]);
  if (existe.rows[0]) {
    await pool.query('UPDATE mantenimientos_programados SET activo=true, ultima_fecha=$1, ultimo_km=$2, proxima_fecha=$3, proximo_km=$4 WHERE id=$5',
      [fecha, kmActual, proximaFecha, proximoKm, existe.rows[0].id]);
  } else {
    await pool.query('INSERT INTO mantenimientos_programados (vehiculo_id,tipo_mantenimiento_id,activo,ultima_fecha,ultimo_km,proxima_fecha,proximo_km) VALUES ($1,$2,true,$3,$4,$5,$6)',
      [vehiculoId, tipoMantId, fecha, kmActual, proximaFecha, proximoKm]);
  }
}

async function calcularCostoPorKm(vehiculoId) {
  const veh = await pool.query('SELECT km_actual FROM vehiculos WHERE id=$1', [vehiculoId]);
  const gastos = await pool.query('SELECT COALESCE(SUM(monto),0) as total FROM gastos WHERE vehiculo_id=$1', [vehiculoId]);
  const km = veh.rows[0]?.km_actual || 1;
  return { costo_por_km: (gastos.rows[0].total / km).toFixed(2) };
}

async function obtenerPresupuesto(vehiculoId, args) {
  const mes = args.mes || mesActual();
  const p = await pool.query('SELECT * FROM presupuestos WHERE vehiculo_id=$1 AND mes=$2', [vehiculoId, mes]);
  const g = await pool.query("SELECT COALESCE(SUM(monto),0) as total FROM gastos WHERE vehiculo_id=$1 AND to_char(fecha,'YYYY-MM')=to_char($2::date,'YYYY-MM')", [vehiculoId, mes]);
  return { asignado: p.rows[0]?.monto_asignado || 0, gastado: g.rows[0].total };
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
  if (args.desde) { q += ` AND fecha>=$${i++}`; params.push(args.desde); }
  if (args.hasta) { q += ` AND fecha<=$${i++}`; params.push(args.hasta); }
  if (args.categoria) { q += ` AND categoria=$${i++}`; params.push(args.categoria); }
  q += ' ORDER BY fecha DESC LIMIT 50';
  const r = await pool.query(q, params);
  return r.rows;
}

async function ejecutarTool(nombre, args, vehiculoId) {
  if (nombre === 'obtener_presupuesto') return obtenerPresupuesto(vehiculoId, args);
  if (nombre === 'obtener_mantenimientos_pendientes') return obtenerMantenimientosPendientes(vehiculoId);
  if (nombre === 'obtener_historial_gastos') return obtenerHistorialGastos(vehiculoId, args);
  if (nombre === 'calcular_costo_por_km') return calcularCostoPorKm(vehiculoId);
  return { error: 'tool no encontrada' };
}

const toolsDefs = [
  { type: 'function', function: { name: 'obtener_presupuesto', description: 'Presupuesto asignado y gastado del mes', parameters: { type: 'object', properties: { mes: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'obtener_mantenimientos_pendientes', description: 'Mantenimientos activos con proxima fecha o km', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'obtener_historial_gastos', description: 'Gastos filtrados por fecha o categoria', parameters: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, categoria: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'calcular_costo_por_km', description: 'Costo real por kilometro recorrido', parameters: { type: 'object', properties: {}, required: [] } } }
];

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
    const { marca, modelo, anio, placa } = req.body;
    let esp = await pool.query('SELECT * FROM especificaciones_vehiculo WHERE marca=$1 AND modelo=$2 AND anio=$3', [marca, modelo, anio]);
    let especificacion = esp.rows[0];
    if (!especificacion) {
      const datos = await buscarSpecsVehiculo(marca, modelo, anio);
      const ins = await pool.query(
        'INSERT INTO especificaciones_vehiculo (marca,modelo,anio,tipo_combustible,rendimiento_km_por_galon,capacidad_tanque_galones,fuente,fecha_consulta) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *',
        [marca, modelo, anio, datos.tipo_combustible, datos.rendimiento_km_por_galon, datos.capacidad_tanque_galones, 'IA-busqueda-web']);
      especificacion = ins.rows[0];
    }
    const veh = await pool.query('INSERT INTO vehiculos (usuario_id,especificacion_id,placa,km_actual) VALUES ($1,$2,$3,0) RETURNING *',
      [req.usuarioId, especificacion.id, placa]);
    res.json({ ...veh.rows[0], especificacion });
  } catch (e) { res.status(500).json({ error: 'no se pudo registrar el vehiculo' }); }
});

// lista los vehiculos del usuario con sus specs
app.get('/vehiculos', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT v.*, e.marca,e.modelo,e.anio,e.tipo_combustible,e.rendimiento_km_por_galon
     FROM vehiculos v JOIN especificaciones_vehiculo e ON e.id=v.especificacion_id WHERE v.usuario_id=$1`, [req.usuarioId]);
  res.json(r.rows);
});

// detalle de un vehiculo con sus specs
app.get('/vehiculos/:id', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  res.json(v);
});

// actualiza km_actual o placa del vehiculo
app.patch('/vehiculos/:id', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  const km = req.body.km_actual ?? v.km_actual;
  const placa = req.body.placa ?? v.placa;
  const r = await pool.query('UPDATE vehiculos SET km_actual=$1, placa=$2 WHERE id=$3 RETURNING *', [km, placa, v.id]);
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
  const { tipo_mantenimiento_id } = req.body;
  const existe = await pool.query('SELECT id FROM mantenimientos_programados WHERE vehiculo_id=$1 AND tipo_mantenimiento_id=$2', [v.id, tipo_mantenimiento_id]);
  if (existe.rows[0]) {
    const r = await pool.query('UPDATE mantenimientos_programados SET activo=true WHERE id=$1 RETURNING *', [existe.rows[0].id]);
    return res.json(r.rows[0]);
  }
  const r = await pool.query('INSERT INTO mantenimientos_programados (vehiculo_id,tipo_mantenimiento_id,activo) VALUES ($1,$2,true) RETURNING *', [v.id, tipo_mantenimiento_id]);
  res.json(r.rows[0]);
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
  const { tipo, categoria, monto, descripcion, fecha, tipo_mantenimiento_id } = req.body;
  const r = await pool.query(
    'INSERT INTO gastos (vehiculo_id,tipo_mantenimiento_id,tipo,categoria,monto,descripcion,fecha,fecha_registro) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *',
    [v.id, tipo_mantenimiento_id || null, tipo, categoria, monto, descripcion, fecha]);
  if (tipo_mantenimiento_id) await actualizarMantenimiento(v.id, tipo_mantenimiento_id, fecha, v.km_actual);
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
  const chk = await pool.query('SELECT g.id FROM gastos g JOIN vehiculos v ON v.id=g.vehiculo_id WHERE g.id=$1 AND v.usuario_id=$2', [req.params.id, req.usuarioId]);
  if (!chk.rows[0]) return res.status(404).json({ error: 'no encontrado' });
  await pool.query('DELETE FROM gastos WHERE id=$1', [req.params.id]);
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
  const costo = await calcularCostoPorKm(v.id);
  res.json({ presupuesto, gastos_por_categoria: porCategoria.rows, proximos_mantenimientos: mantenimientos.rows, costo_por_km: costo.costo_por_km });
});

// chat con la IA: usa tools de lectura sobre la DB del vehiculo, sin memoria entre sesiones
app.post('/vehiculos/:id/chat', auth, async (req, res) => {
  const v = await vehiculoDeUsuario(req.params.id, req.usuarioId);
  if (!v) return res.status(404).json({ error: 'no encontrado' });
  let mensajes = [
    { role: 'system', content: 'Eres el mecanico y amigo personal del usuario para su vehiculo. Responde corto y cercano, usa las tools para datos reales, nunca inventes cifras.' },
    { role: 'user', content: req.body.mensaje }
  ];
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-small-latest', messages: mensajes, tools: toolsDefs, tool_choice: 'auto' })
    });
    const data = await r.json();
    const msg = data.choices[0].message;
    if (!msg.tool_calls) return res.json({ respuesta: msg.content });
    mensajes.push(msg);
    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments || '{}');
      const resultado = await ejecutarTool(tc.function.name, args, v.id);
      mensajes.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(resultado) });
    }
  }
  res.json({ respuesta: 'no se pudo procesar la consulta' });
});

app.listen(process.env.PORT || 3000);
