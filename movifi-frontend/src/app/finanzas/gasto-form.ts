import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { hoyISO, parseFecha } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-gasto-form',
  imports: [FormsModule],
  templateUrl: './gasto-form.html',
  styleUrl: './gasto-form.scss',
})
export class GastoForm {
  protected store = inject(FinanzasStore);

  protected readonly sugeridas = ['Combustible', 'Reparación', 'Lavado', 'Peaje', 'Estacionamiento', 'Accesorios', 'Multa'];
  protected readonly tiposElegibles = computed(() => this.store.tipos().filter((t) => t.nombre !== 'Otro'));

  // si se abre desde "Hecho" de un mantenimiento, ya viene como programado
  private inicial = this.store.formularioGasto()?.tipoMantId;
  protected programado = signal(this.inicial != null);
  protected tipoMantId: number | null = this.inicial ?? null;
  protected categoria = '';
  protected monto: number | null = null;
  protected readonly hoy = hoyISO();
  protected fecha = hoyISO();
  protected descripcion = '';
  protected km: number | null = this.store.vehiculo()?.km_actual ?? null;

  protected enviando = signal(false);
  protected error = signal('');

  // para cargas de combustible: cuántos galones y km compra ese monto con el precio y rendimiento guardados
  protected pistaCombustible(): { galones: number; km: number } | null {
    const c = this.store.combustible();
    if (this.programado() || !this.monto || !c?.precio_galon || !c.rendimiento_km_por_galon) return null;
    if (!this.categoria.trim().toLowerCase().startsWith('combustible')) return null;
    const galones = this.monto / c.precio_galon;
    return { galones, km: galones * c.rendimiento_km_por_galon };
  }

  // servicio con fecha de hace más de una semana: el odómetro de hoy ya no aplica
  protected esAntiguo(): boolean {
    return !!this.fecha && Date.now() - parseFecha(this.fecha).getTime() > 7 * 86_400_000;
  }

  protected cerrar(): void {
    this.store.formularioGasto.set(null);
  }

  protected async guardar(): Promise<void> {
    if (!this.monto || this.monto <= 0) return;
    const tipo = this.tiposElegibles().find((t) => t.id === this.tipoMantId);
    if (this.programado() && !tipo) {
      this.error.set('Elige qué mantenimiento fue.');
      return;
    }
    const categoria = this.programado() ? tipo!.nombre : this.categoria.trim();
    if (!categoria) {
      this.error.set('Ponle una categoría al gasto.');
      return;
    }
    this.error.set('');
    this.enviando.set(true);
    try {
      await this.store.registrarGasto(
        {
          tipo: this.programado() ? 'programado' : 'no_programado',
          categoria,
          monto: this.monto,
          descripcion: this.descripcion.trim(),
          fecha: this.fecha,
          tipo_mantenimiento_id: this.programado() ? this.tipoMantId : null,
        },
        this.km,
      );
      this.cerrar();
    } catch {
      this.error.set('No se pudo guardar el gasto. Intenta de nuevo.');
    } finally {
      this.enviando.set(false);
    }
  }
}
