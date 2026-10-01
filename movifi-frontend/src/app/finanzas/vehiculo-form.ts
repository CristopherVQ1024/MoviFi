import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GRADOS_COMBUSTIBLE } from '../core/api.service';
import { AutoDeportivo } from '../shared/auto-deportivo';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-vehiculo-form',
  imports: [FormsModule, AutoDeportivo],
  templateUrl: './vehiculo-form.html',
  styleUrl: './vehiculo-form.scss',
})
export class VehiculoForm {
  private store = inject(FinanzasStore);

  protected marca = '';
  protected modelo = '';
  protected anio: number | null = null;
  protected placa = '';
  protected combustible = 'Regular 90';
  protected readonly grados = GRADOS_COMBUSTIBLE;
  protected enviando = signal(false);
  protected error = signal('');

  protected async guardar(): Promise<void> {
    if (!this.marca || !this.modelo || !this.anio) return;
    this.error.set('');
    this.enviando.set(true);
    try {
      await this.store.registrarVehiculo({
        marca: this.marca.trim(),
        modelo: this.modelo.trim(),
        anio: this.anio,
        placa: this.placa.trim().toUpperCase(),
        combustible_grado: this.combustible,
      });
    } catch {
      this.error.set('No pudimos registrar el auto. Revisa los datos e intenta de nuevo.');
    } finally {
      this.enviando.set(false);
    }
  }
}
