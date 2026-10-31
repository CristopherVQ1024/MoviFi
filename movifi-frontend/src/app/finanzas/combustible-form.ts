import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GRADOS_COMBUSTIBLE } from '../core/api.service';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-combustible-form',
  imports: [FormsModule, SolesPipe],
  templateUrl: './combustible-form.html',
  styleUrl: './combustible-form.scss',
})
export class CombustibleForm {
  protected store = inject(FinanzasStore);
  protected readonly grados = GRADOS_COMBUSTIBLE;

  private actual = this.store.combustible();
  protected grado = this.actual?.grado ?? '';
  protected rendimiento: number | null = this.actual?.rendimiento_km_por_galon ?? null;
  protected precio: number | null = this.actual?.precio_galon ?? null;

  private mensualActual = this.store.vehiculo()?.combustible_mensual != null ? Number(this.store.vehiculo()!.combustible_mensual) : null;
  protected mensual: number | null = this.mensualActual;

  private capacidadActual = this.actual?.tanque.capacidad_galones ?? null;
  protected capacidad: number | null = this.capacidadActual;
  protected readonly capacidadOrigen = this.actual?.tanque.capacidad_origen ?? 'ia';

  protected readonly origen = this.actual?.rendimiento_origen ?? 'ia';

  // equipo a gas GLP, se puede activar despues de registrar el auto
  protected readonly glpActual = this.actual?.glp;
  protected dual = this.glpActual?.activo ?? false;
  protected glpCapacidad: number | null = this.glpActual?.tanque.capacidad_galones ?? null;
  protected glpRendimiento: number | null = this.glpActual?.rendimiento_km_por_galon ?? null;
  protected glpPrecio: number | null = this.glpActual?.precio_galon ?? null;
  protected readonly glpOrigen = this.glpActual?.rendimiento_origen ?? 'estimado';
  protected enviando = signal(false);
  protected error = signal('');

  // cuánto rinde una carga típica con los valores que se están editando
  protected ejemplo(): { monto: number; galones: number; km: number } | null {
    if (!this.precio || !this.rendimiento) return null;
    const monto = Math.round(this.actual?.promedio_por_carga ?? 50);
    const galones = monto / this.precio;
    return { monto, galones, km: galones * this.rendimiento };
  }

  protected cerrar(): void {
    this.store.ajustesCombustible.set(false);
  }

  // solo se envía lo que el usuario cambió; null vuelve al valor automático (IA o precio de referencia)
  protected async guardar(volverA?: 'estimado' | 'referencia' | 'glp-estimado' | 'glp-referencia'): Promise<void> {
    const cambios: Parameters<FinanzasStore['actualizarCombustible']>[0] = {};
    if (this.grado && this.grado !== this.actual?.grado) cambios.combustible_grado = this.grado;
    if (volverA === 'estimado') cambios.rendimiento_manual = null;
    else if (this.rendimiento && this.rendimiento !== this.actual?.rendimiento_km_por_galon) {
      cambios.rendimiento_manual = this.rendimiento;
    }
    if ((this.mensual ?? null) !== this.mensualActual) cambios.combustible_mensual = this.mensual ?? null;
    if (this.capacidad && this.capacidad !== this.capacidadActual) cambios.capacidad_manual = this.capacidad;
    if (volverA === 'referencia') cambios.precio_galon = null;
    else if (this.precio && this.precio !== this.actual?.precio_galon && !cambios.combustible_grado) {
      cambios.precio_galon = this.precio;
    }
    if (this.dual !== (this.glpActual?.activo ?? false)) cambios.dual_glp = this.dual;
    if (this.dual) {
      const g = this.glpActual;
      if (this.glpCapacidad && this.glpCapacidad !== g?.tanque.capacidad_galones) cambios.glp_capacidad = this.glpCapacidad;
      if (volverA === 'glp-estimado') cambios.glp_rendimiento_manual = null;
      else if (this.glpRendimiento && this.glpRendimiento !== g?.rendimiento_km_por_galon) {
        cambios.glp_rendimiento_manual = this.glpRendimiento;
      }
      if (volverA === 'glp-referencia') cambios.glp_precio_galon = null;
      else if (this.glpPrecio && this.glpPrecio !== g?.precio_galon) cambios.glp_precio_galon = this.glpPrecio;
    }
    if (!Object.keys(cambios).length) return this.cerrar();

    this.error.set('');
    this.enviando.set(true);
    try {
      await this.store.actualizarCombustible(cambios);
      this.cerrar();
    } catch {
      this.error.set('No se pudo guardar. Revisa los valores e intenta de nuevo.');
    } finally {
      this.enviando.set(false);
    }
  }
}
