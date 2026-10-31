import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LecturaNivel, ResultadoNivel, TipoCombustible } from '../core/api.service';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

const redondear = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const entre = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

// gasolina se marca en medias barras de 10; el GLP en LEDs enteros de 4, con media LED de precisión de lectura
const MEDIDOR = {
  gasolina: { barras: 10, paso: 0.5, precision: 0.1, unidad: ['barra', 'barras'], nombre: 'combustible' },
  glp: { barras: 4, paso: 1, precision: 0.5, unidad: ['LED', 'LEDs'], nombre: 'GLP' },
} as const;

@Component({
  selector: 'app-tanque-combustible',
  imports: [FormsModule, DecimalPipe, SolesPipe],
  templateUrl: './tanque-combustible.html',
  styleUrl: './tanque-combustible.scss',
  host: { '[class.glp]': "tipo() === 'glp'" },
})
export class TanqueCombustible {
  protected store = inject(FinanzasStore);
  private barra = viewChild<ElementRef<HTMLElement>>('barra');

  readonly tipo = input<TipoCombustible>('gasolina');
  protected readonly cfg = computed(() => MEDIDOR[this.tipo()]);
  protected readonly barras = computed(() => this.cfg().barras);
  protected readonly indices = computed(() => Array.from({ length: this.barras() }, (_, i) => i));

  private readonly fuente = computed(() => {
    const c = this.store.combustible();
    if (!c) return null;
    return this.tipo() === 'glp' ? c.glp : { ...c, activo: true };
  });
  protected readonly tanque = computed(() => this.fuente()?.tanque ?? null);
  // el medidor de GLP se ve apagado mientras el auto no tenga equipo a gas
  protected readonly activo = computed(() => this.fuente()?.activo ?? false);

  // lo que el usuario está marcando (aún sin guardar) y los campos del detalle
  protected borrador = signal<number | null>(null);
  protected modoCarga = signal(false);
  protected montoCarga = signal<number | null>(null);
  protected antesEdit = signal<number | null>(null);
  protected kmEdit = signal<number | null>(null);
  protected montoEdit = signal<number | null>(null);
  protected guardando = signal(false);
  protected mensaje = signal<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  private arrastrando = false;
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  protected readonly guardado = computed(() => this.tanque()?.nivel ?? null);
  protected readonly listo = computed(() => this.activo() && !!this.tanque()?.galones_por_barra);
  private readonly rendimiento = computed(() => this.fuente()?.rendimiento_km_por_galon ?? null);
  private readonly precio = computed(() => this.fuente()?.precio_galon ?? null);

  protected unidad(n: number): string {
    return this.cfg().unidad[n === 1 ? 0 : 1];
  }

  // barras que compra el monto escrito en "Cargué" y nivel resultante (tope: tanque lleno)
  protected readonly barrasCarga = computed(() => {
    const costo = this.tanque()?.costo_por_barra;
    const monto = this.montoCarga();
    return costo && monto && monto > 0 ? monto / costo : null;
  });
  // lo que marcaba el medidor justo antes de cargar (por defecto, el último nivel guardado)
  protected readonly nivelAntes = computed(() => this.antesEdit() ?? this.guardado());
  protected readonly nivelCarga = computed(() => {
    const b = this.barrasCarga();
    const a = this.nivelAntes();
    return b != null && a != null ? Math.min(redondear(a + b), this.barras()) : null;
  });
  protected readonly desborda = computed(() => {
    const b = this.barrasCarga();
    const a = this.nivelAntes();
    return b != null && a != null && a + b > this.barras();
  });
  // consumo entre la última lectura guardada y el momento de cargar
  protected readonly consumoPrevio = computed(() => {
    const g = this.guardado();
    const a = this.nivelAntes();
    const t = this.tanque();
    if (g == null || a == null || a >= g || !t?.galones_por_barra) return null;
    const galones = (g - a) * t.galones_por_barra;
    return { barras: redondear(g - a), galones, km: this.rendimiento() ? galones * this.rendimiento()! : null };
  });

  protected readonly mostrado = computed(() => {
    const b = this.borrador();
    if (b !== null) return b;
    if (this.modoCarga() && this.nivelCarga() !== null) return this.nivelCarga()!;
    return this.guardado() ?? 0;
  });

  // tramo "sólido" (ya guardado) y tramo "fantasma" (lo que cambiaría); sube = se está llenando
  protected readonly rango = computed(() => {
    const g = this.guardado() ?? 0;
    const m = this.mostrado();
    return { solido: Math.min(g, m), hasta: Math.max(g, m), sube: m > g };
  });

  protected readonly kmEfectivo = computed(() => this.kmEdit() ?? this.store.vehiculo()?.km_actual ?? 0);

  protected readonly analisis = computed(() => {
    const t = this.tanque();
    const b = this.borrador();
    if (!t || b === null) return null;
    const gpb = t.galones_por_barra;
    const g = t.nivel;
    const rend = this.rendimiento();
    if (g === null) {
      return { tipo: 'primero' as const, nivel: b, galones: gpb ? b * gpb : null, autonomia: gpb && rend ? b * gpb * rend : null };
    }
    if (b < g) {
      const barras = g - b;
      const galones = gpb ? barras * gpb : null;
      const costo = galones && this.precio() ? galones * this.precio()! : null;
      const kmN = this.kmEfectivo();
      const kmRec = t.km_nivel != null && kmN > t.km_nivel ? kmN - t.km_nivel : null;
      // mismo criterio que el backend, con un margen de lectura mayor al 50% no se calcula rendimiento
      let rendimiento = kmRec && galones && this.cfg().precision / barras <= 0.5 ? kmRec / galones : null;
      if (rendimiento != null && (rendimiento < 5 || rendimiento > 150)) rendimiento = null;
      const kmEst = kmRec == null && galones && rend ? galones * rend : null;
      return { tipo: 'baja' as const, barras, galones, costo, kmRec, rendimiento, kmEst };
    }
    if (b > g) {
      const barras = b - g;
      return { tipo: 'sube' as const, barras, galones: gpb ? barras * gpb : null, montoEst: t.costo_por_barra ? barras * t.costo_por_barra : null };
    }
    return null;
  });

  protected readonly montoEfectivo = computed(() => {
    const a = this.analisis();
    return this.montoEdit() ?? (a?.tipo === 'sube' && a.montoEst ? Math.round(a.montoEst) : null);
  });

  // si lo medido en viajes difiere del rendimiento usado más de 8% y más que su margen de error, se ofrece corregirlo
  protected readonly sugerencia = computed(() => {
    const real = this.fuente()?.rendimiento_real;
    const usado = this.rendimiento();
    if (!real || !usado) return null;
    const dif = Math.abs(real.valor - usado) / usado;
    return dif > 0.08 && Math.abs(real.valor - usado) > real.valor * real.margen_error ? real : null;
  });

  protected readonly resumen = computed(() => {
    const t = this.tanque();
    if (!t) return '';
    if (!this.activo()) return 'Sin equipo GLP';
    if (!t.galones_por_barra) return 'Indica la capacidad del tanque en Ajustar.';
    if (t.nivel === null && this.borrador() === null) return 'Toca el medidor para marcar tu nivel.';
    const n = this.borrador() ?? t.nivel!;
    const gal = n * t.galones_por_barra;
    const km = this.rendimiento() ? ` · ~${Math.round(gal * this.rendimiento()!)} km` : '';
    return `${n} / ${this.barras()} ${this.unidad(n)} · ${gal.toFixed(1)} gal${km}`;
  });

  // galones y autonomía del nivel mostrado, para la columna de texto junto al medidor
  protected readonly lineas = computed(() => {
    const t = this.tanque();
    if (!t || !this.activo()) return [];
    const n = this.borrador() ?? t.nivel ?? null;
    if (!t.galones_por_barra) return ['Indica la capacidad', 'en Ajustar'];
    if (n === null) return [];
    const gal = n * t.galones_por_barra;
    const rend = this.rendimiento();
    return [`${gal.toFixed(1)} gal`, ...(rend ? [`~${Math.round(gal * rend)} km`] : [])];
  });

  protected frac(i: number, hasta: number): number {
    return entre(hasta - i, 0, 1);
  }

  protected color(i: number): string {
    if (this.tipo() === 'glp') return i === 0 ? '#ff6f8e' : '#4ae3b5';
    return i < 2 ? '#ff6f8e' : i < 4 ? '#ffb347' : '#3ad6ff';
  }

  // ---- interacción con el medidor (click, arrastre o teclado), en el paso de cada medidor ----
  protected empezar(e: PointerEvent): void {
    if (!this.listo()) return;
    this.mensaje.set(null);
    this.modoCarga.set(false);
    this.arrastrando = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.fijar(e);
  }

  protected arrastrar(e: PointerEvent): void {
    if (this.arrastrando) this.fijar(e);
  }

  protected terminar(): void {
    this.arrastrando = false;
  }

  private fijar(e: PointerEvent): void {
    const el = this.barra()?.nativeElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const paso = this.cfg().paso;
    const valor = Math.round((entre((r.bottom - e.clientY) / r.height, 0, 1) * this.barras()) / paso) * paso;
    this.borrador.set(valor === this.guardado() ? null : valor);
  }

  protected teclado(e: KeyboardEvent): void {
    if (!this.listo()) return;
    const actual = this.borrador() ?? this.guardado() ?? 0;
    const p = this.cfg().paso;
    const paso: Record<string, number> = { ArrowUp: p, ArrowRight: p, ArrowDown: -p, ArrowLeft: -p };
    if (e.key in paso) {
      e.preventDefault();
      this.borrador.set(entre(actual + paso[e.key], 0, this.barras()));
    } else if (e.key === 'Escape') {
      this.cancelar();
    }
  }

  protected alternarCarga(): void {
    this.mensaje.set(null);
    this.borrador.set(null);
    this.montoCarga.set(null);
    this.antesEdit.set(null);
    this.modoCarga.update((v) => !v);
  }

  protected cancelar(): void {
    this.borrador.set(null);
    this.kmEdit.set(null);
    this.montoEdit.set(null);
    this.modoCarga.set(false);
    this.montoCarga.set(null);
    this.antesEdit.set(null);
  }

  // ---- guardar ----
  protected async guardarLectura(conCarga = false): Promise<void> {
    const nivel = this.borrador();
    if (nivel === null) return;
    const a = this.analisis();
    await this.enviar({
      nivel,
      km: a?.tipo === 'baja' || a?.tipo === 'primero' ? this.kmEfectivo() : null,
      monto: conCarga ? this.montoEfectivo() : null,
    });
  }

  protected async registrarCarga(): Promise<void> {
    const nivel = this.nivelCarga();
    const monto = this.montoCarga();
    if (nivel === null || !monto) return;
    const antes = this.nivelAntes();
    await this.enviar({ nivel, monto, nivel_antes: antes !== null && antes < (this.guardado() ?? 0) ? antes : null });
  }

  private async enviar(d: LecturaNivel): Promise<void> {
    this.guardando.set(true);
    try {
      const r = await this.store.guardarNivel({ ...d, combustible: this.tipo() });
      this.cancelar();
      this.avisar('ok', this.textoResultado(r, d.monto ?? 0));
    } catch (e) {
      this.avisar('error', (e as HttpErrorResponse).error?.error ?? 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.guardando.set(false);
    }
  }

  private textoResultado(r: ResultadoNivel, monto: number): string {
    if (r.tramo) {
      const t = r.tramo;
      const base = `Gastaste ≈ ${redondear(t.barras)} ${this.unidad(t.barras)} (${t.galones.toFixed(1)} gal${t.costo ? ` · S/ ${t.costo.toFixed(0)}` : ''}).`;
      const otro = t.combustible === 'glp' ? 'gasolina' : 'GLP';
      const descuento = t.mixto && t.km_otro_combustible ? ` descontando ≈ ${Math.round(t.km_otro_combustible)} km con ${otro}` : '';
      if (t.rendimiento) return `${base} Recorriste ${t.km_recorridos} km${descuento}: rindes ≈ ${t.rendimiento.toFixed(0)} km/gal${t.margen_error ? ` (± ${Math.round(t.margen_error * 100)}%)` : ''}.`;
      if (t.km_estimados) return `${base} Sumé ≈ ${Math.round(t.km_estimados)} km a tu odómetro estimado (≈ ${r.odometro.estimado.toLocaleString('es-PE')} km).`;
      if (t.mixto) return `${base} Parte de esos km fueron con ${otro}, así que esta vez no pude medir tu rendimiento.`;
      return `${base} Actualiza el odómetro para calcular tu rendimiento real.`;
    }
    const u = this.unidad(r.nivel);
    return monto ? `Carga de S/ ${monto} registrada. El medidor quedó en ${r.nivel} ${u}.` : `Nivel guardado: ${r.nivel} ${u}.`;
  }

  private avisar(tipo: 'ok' | 'error', texto: string): void {
    clearTimeout(this.temporizador);
    this.mensaje.set({ tipo, texto });
    this.temporizador = setTimeout(() => this.mensaje.set(null), 10_000);
  }

  protected async usarRendimiento(valor: number): Promise<void> {
    const v = redondear(valor);
    try {
      await this.store.actualizarCombustible(this.tipo() === 'glp' ? { glp_rendimiento_manual: v } : { rendimiento_manual: v });
      this.avisar('ok', `Listo: ahora uso ${v} km/gal.`);
    } catch {
      this.avisar('error', 'No se pudo actualizar el rendimiento.');
    }
  }
}
