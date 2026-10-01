import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ResultadoNivel } from '../core/api.service';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

const BARRAS = 10;
const redondear = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const entre = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

@Component({
  selector: 'app-tanque-combustible',
  imports: [FormsModule, DecimalPipe, SolesPipe],
  templateUrl: './tanque-combustible.html',
  styleUrl: './tanque-combustible.scss',
})
export class TanqueCombustible {
  protected store = inject(FinanzasStore);
  private barra = viewChild<ElementRef<HTMLElement>>('barra');

  protected readonly indices = Array.from({ length: BARRAS }, (_, i) => i);
  protected readonly tanque = this.store.tanque;

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
  protected readonly listo = computed(() => !!this.tanque()?.galones_por_barra);
  private readonly rendimiento = computed(() => this.store.combustible()?.rendimiento_km_por_galon ?? null);
  private readonly precio = computed(() => this.store.combustible()?.precio_galon ?? null);

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
    return b != null && a != null ? Math.min(redondear(a + b), BARRAS) : null;
  });
  protected readonly desborda = computed(() => {
    const b = this.barrasCarga();
    const a = this.nivelAntes();
    return b != null && a != null && a + b > BARRAS;
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
      let rendimiento = kmRec && galones && barras >= 1 ? kmRec / galones : null;
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

  // si lo medido en viajes difiere más de 8% del rendimiento usado, se ofrece corregirlo (siempre con confirmación)
  protected readonly sugerencia = computed(() => {
    const real = this.store.combustible()?.rendimiento_real;
    const usado = this.rendimiento();
    return real && usado && Math.abs(real.valor - usado) / usado > 0.08 ? real : null;
  });

  protected readonly resumen = computed(() => {
    const t = this.tanque();
    if (!t) return '';
    if (!t.galones_por_barra) return 'Indica la capacidad del tanque en Ajustar.';
    if (t.nivel === null && this.borrador() === null) return 'Toca la barra para marcar tu nivel.';
    const n = this.borrador() ?? t.nivel!;
    const gal = n * t.galones_por_barra;
    const km = this.rendimiento() ? ` · ~${Math.round(gal * this.rendimiento()!)} km` : '';
    return `${n} / ${BARRAS} barras · ${gal.toFixed(1)} gal${km}`;
  });

  // galones y autonomía del nivel mostrado, para la columna de texto junto a la barra
  protected readonly lineas = computed(() => {
    const t = this.tanque();
    const n = this.borrador() ?? t?.nivel ?? null;
    if (!t?.galones_por_barra) return t ? ['Indica la capacidad', 'en Ajustar'] : [];
    if (n === null) return [];
    const gal = n * t.galones_por_barra;
    const rend = this.rendimiento();
    return [`${gal.toFixed(1)} gal`, ...(rend ? [`~${Math.round(gal * rend)} km`] : [])];
  });

  protected frac(i: number, hasta: number): number {
    return entre(hasta - i, 0, 1);
  }

  protected color(i: number): string {
    return i < 2 ? '#ff6f8e' : i < 4 ? '#ffb347' : '#3ad6ff';
  }

  // ---- interacción con la barra (click, arrastre o teclado), en pasos de media barra ----
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
    const valor = Math.round(entre((r.bottom - e.clientY) / r.height, 0, 1) * BARRAS * 2) / 2;
    this.borrador.set(valor === this.guardado() ? null : valor);
  }

  protected teclado(e: KeyboardEvent): void {
    if (!this.listo()) return;
    const actual = this.borrador() ?? this.guardado() ?? 0;
    const paso: Record<string, number> = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5 };
    if (e.key in paso) {
      e.preventDefault();
      this.borrador.set(entre(actual + paso[e.key], 0, BARRAS));
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

  private async enviar(d: { nivel: number; km?: number | null; monto?: number | null; nivel_antes?: number | null }): Promise<void> {
    this.guardando.set(true);
    try {
      const r = await this.store.guardarNivel(d);
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
      const base = `Gastaste ≈ ${redondear(t.barras)} barras (${t.galones.toFixed(1)} gal${t.costo ? ` · S/ ${t.costo.toFixed(0)}` : ''}).`;
      if (t.rendimiento) return `${base} Recorriste ${t.km_recorridos} km: rindes ≈ ${t.rendimiento.toFixed(0)} km/gal.`;
      if (t.km_estimados) return `${base} Sumé ≈ ${Math.round(t.km_estimados)} km a tu odómetro estimado (≈ ${r.odometro.estimado.toLocaleString('es-PE')} km).`;
      return `${base} Actualiza el odómetro para calcular tu rendimiento real.`;
    }
    return monto ? `Carga de S/ ${monto} registrada. El medidor quedó en ${r.nivel} barras.` : `Nivel guardado: ${r.nivel} barras.`;
  }

  private avisar(tipo: 'ok' | 'error', texto: string): void {
    clearTimeout(this.temporizador);
    this.mensaje.set({ tipo, texto });
    this.temporizador = setTimeout(() => this.mensaje.set(null), 10_000);
  }

  protected async usarRendimiento(valor: number): Promise<void> {
    try {
      await this.store.actualizarCombustible({ rendimiento_manual: redondear(valor) });
      this.avisar('ok', `Listo: ahora uso ${redondear(valor)} km/gal.`);
    } catch {
      this.avisar('error', 'No se pudo actualizar el rendimiento.');
    }
  }
}
