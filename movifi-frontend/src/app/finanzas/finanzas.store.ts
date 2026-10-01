import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ApiService,
  Copiloto,
  Dashboard,
  Gasto,
  Mantenimiento,
  Nota,
  NuevoGasto,
  TipoMantenimiento,
  Vehiculo,
} from '../core/api.service';
import { COLORES_CATEGORIA, diasHasta } from '../shared/formato';

export type EstadoMant = 'vencido' | 'pronto' | 'ok' | 'sin-datos';

export interface MantenimientoVista extends Mantenimiento {
  estado: EstadoMant;
  dias: number | null;
  kmRestantes: number | null;
}

export interface Categoria {
  nombre: string;
  total: number;
  pct: number;
  color: string;
}

function mesISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

@Injectable()
export class FinanzasStore {
  private api = inject(ApiService);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly vehiculo = signal<Vehiculo | null>(null);
  readonly dashboard = signal<Dashboard | null>(null);
  readonly gastos = signal<Gasto[]>([]);
  readonly mantenimientos = signal<Mantenimiento[]>([]);
  readonly tipos = signal<TipoMantenimiento[]>([]);
  readonly notas = signal<Nota[]>([]);

  // formulario de gasto abierto (y, si viene de un mantenimiento, su tipo precargado)
  readonly copiloto = signal<Copiloto | null>(null);
  readonly copilotoCargando = signal(false);
  readonly ajustesCombustible = signal(false);
  readonly viajeAbierto = signal(false);
  readonly formularioGasto = signal<{ tipoMantId?: number } | null>(null);

  readonly presupuesto = computed(() => {
    const p = this.dashboard()?.presupuesto;
    const asignado = Number(p?.asignado ?? 0);
    const gastado = Number(p?.gastado ?? 0);
    const hoy = new Date();
    const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasRestantes = Math.max(diasMes - hoy.getDate() + 1, 1);
    const restante = asignado - gastado;
    return {
      asignado,
      gastado,
      restante,
      pct: asignado > 0 ? Math.min(gastado / asignado, 1) : 0,
      excedido: asignado > 0 && gastado > asignado,
      porDia: restante > 0 ? restante / diasRestantes : 0,
      definido: asignado > 0,
    };
  });

  // cada categoría conocida recibe un color distinto, estable mientras no aparezcan categorías nuevas
  private readonly mapaColores = computed(() => {
    const nombres = new Set<string>();
    this.gastos().forEach((g) => nombres.add(g.categoria || 'Sin categoría'));
    (this.dashboard()?.gastos_por_categoria ?? []).forEach((c) => nombres.add(c.categoria || 'Sin categoría'));
    return new Map([...nombres].sort().map((n, i) => [n, COLORES_CATEGORIA[i % COLORES_CATEGORIA.length]]));
  });

  colorDe(nombre: string | null): string {
    return this.mapaColores().get(nombre || 'Sin categoría') ?? COLORES_CATEGORIA[0];
  }

  readonly categorias = computed<Categoria[]>(() => {
    const filas = (this.dashboard()?.gastos_por_categoria ?? []).map((c) => ({
      nombre: c.categoria || 'Sin categoría',
      total: Number(c.total),
    }));
    const suma = filas.reduce((s, c) => s + c.total, 0);
    return filas
      .sort((a, b) => b.total - a.total)
      .map((c) => ({ ...c, pct: suma ? c.total / suma : 0, color: this.colorDe(c.nombre) }));
  });

  readonly mantenimientosVista = computed<MantenimientoVista[]>(() => {
    // los avisos por km usan el odómetro estimado: así avanzan entre una actualización manual y otra
    const km = this.odometro()?.estimado ?? this.vehiculo()?.km_actual ?? 0;
    return this.mantenimientos().map((m) => {
      const dias = diasHasta(m.proxima_fecha);
      const kmRestantes = m.proximo_km != null ? m.proximo_km - km : null;
      let estado: EstadoMant = 'sin-datos';
      if (dias != null || kmRestantes != null) {
        if ((dias != null && dias < 0) || (kmRestantes != null && kmRestantes <= 0)) estado = 'vencido';
        else if ((dias != null && dias <= 30) || (kmRestantes != null && kmRestantes <= 500)) estado = 'pronto';
        else estado = 'ok';
      }
      return { ...m, estado, dias, kmRestantes };
    });
  });

  // 100 menos penalizaciones por mantenimientos vencidos/próximos y por pasarse del presupuesto
  readonly salud = computed(() => {
    let s = 100;
    for (const m of this.mantenimientosVista()) {
      if (m.estado === 'vencido') s -= 25;
      else if (m.estado === 'pronto') s -= 8;
    }
    if (this.presupuesto().excedido) s -= 10;
    return Math.max(s, 0);
  });

  readonly proximoMantenimiento = computed(() => {
    const con = this.mantenimientosVista().filter((m) => m.estado !== 'sin-datos');
    return con.sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999))[0] ?? null;
  });

  readonly combustible = computed(() => this.dashboard()?.combustible ?? null);
  readonly tanque = computed(() => this.dashboard()?.combustible.tanque ?? null);
  readonly odometro = computed(() => this.dashboard()?.odometro ?? null);
  readonly libre = computed(() => this.dashboard()?.libre ?? null);

  // costo real por km si ya hay km recorridos desde el registro; si no, el estimado solo de combustible
  readonly costoKm = computed(() => {
    const d = this.dashboard();
    if (d?.costo_por_km != null) return { valor: d.costo_por_km, origen: 'real' as const };
    const c = d?.combustible.costo_por_km;
    return c != null ? { valor: c, origen: 'combustible' as const } : null;
  });

  async iniciar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const [vehiculos, tipos] = await Promise.all([this.api.vehiculos(), this.api.tipos()]);
      this.tipos.set(tipos);
      this.vehiculo.set(vehiculos[0] ?? null);
      if (vehiculos[0]) await this.cargarDatos();
    } catch {
      this.error.set('No pudimos conectar con el servidor.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarDatos(): Promise<void> {
    const v = this.vehiculo();
    if (!v) return;
    const [vehiculos, dashboard, gastos, mantenimientos, notas] = await Promise.all([
      this.api.vehiculos(),
      this.api.dashboard(v.id),
      this.api.gastos(v.id),
      this.api.mantenimientos(v.id),
      this.api.notas(v.id),
    ]);
    this.vehiculo.set(vehiculos.find((x) => x.id === v.id) ?? v);
    this.dashboard.set(dashboard);
    this.gastos.set(gastos);
    this.mantenimientos.set(mantenimientos);
    this.notas.set(notas);
    // el aviso del copiloto puede tardar (lo redacta la IA): no bloquea el resto de la pantalla
    void this.cargarCopiloto();
  }

  async cargarCopiloto(): Promise<void> {
    const v = this.vehiculo();
    if (!v) return;
    this.copilotoCargando.set(true);
    try {
      this.copiloto.set(await this.api.copiloto(v.id));
    } catch {
      this.copiloto.set(null);
    } finally {
      this.copilotoCargando.set(false);
    }
  }

  meAlcanza(monto: number) {
    return this.api.meAlcanza(this.vehiculo()!.id, monto);
  }

  async registrarVehiculo(d: { marca: string; modelo: string; anio: number; placa: string; combustible_grado: string }) {
    await this.api.crearVehiculo(d);
    await this.iniciar();
  }

  async actualizarKm(km: number) {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.actualizarVehiculo(v.id, { km_actual: km });
    await this.cargarDatos();
  }

  async actualizarCombustible(d: {
    combustible_grado?: string;
    rendimiento_manual?: number | null;
    precio_galon?: number | null;
    combustible_mensual?: number | null;
    capacidad_manual?: number | null;
  }) {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.actualizarVehiculo(v.id, d);
    await this.cargarDatos();
  }

  // fija el nivel del medidor; si hay monto, el backend registra además la carga como gasto
  async guardarNivel(d: { nivel: number; km?: number | null; monto?: number | null; nivel_antes?: number | null }) {
    const v = this.vehiculo();
    if (!v) throw new Error('sin vehiculo');
    const r = await this.api.fijarNivel(v.id, d);
    await this.cargarDatos();
    return r;
  }

  async reiniciarRecorrido() {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.reiniciarRecorrido(v.id);
    await this.cargarDatos();
  }

  async agregarNota(texto: string) {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.crearNota(v.id, texto);
    this.notas.set(await this.api.notas(v.id));
  }

  async editarNota(id: number, texto: string) {
    await this.api.editarNota(id, texto);
    this.notas.set(await this.api.notas(this.vehiculo()!.id));
  }

  async borrarNota(id: number) {
    await this.api.borrarNota(id);
    this.notas.set(await this.api.notas(this.vehiculo()!.id));
  }

  estimarViaje(d: { km: number; ida_vuelta: boolean; peajes: number | null }) {
    return this.api.estimarViaje(this.vehiculo()!.id, d);
  }

  async guardarPresupuesto(monto: number) {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.guardarPresupuesto(v.id, mesISO(), monto);
    await this.cargarDatos();
  }

  async registrarGasto(g: NuevoGasto, km?: number | null) {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.crearGasto(v.id, { ...g, km: km ?? null });
    await this.cargarDatos();
  }

  async eliminarGasto(id: number) {
    await this.api.eliminarGasto(id);
    await this.cargarDatos();
  }

  async activarMantenimiento(tipoId: number, ultima?: { ultima_fecha?: string; ultimo_km?: number | null }) {
    const v = this.vehiculo();
    if (!v) return;
    await this.api.activarMantenimiento(v.id, tipoId, ultima);
    await this.cargarDatos();
  }

  async quitarMantenimiento(id: number) {
    await this.api.quitarMantenimiento(id);
    await this.cargarDatos();
  }
}
