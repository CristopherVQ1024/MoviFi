import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Viaje } from '../core/api.service';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-viaje-form',
  imports: [FormsModule, DecimalPipe, SolesPipe],
  templateUrl: './viaje-form.html',
  styleUrl: './viaje-form.scss',
})
export class ViajeForm {
  protected store = inject(FinanzasStore);

  protected km: number | null = null;
  protected idaVuelta = true;
  protected peajes: number | null = null;

  protected calculando = signal(false);
  protected resultado = signal<Viaje | null>(null);
  protected error = signal('');

  protected cerrar(): void {
    this.store.viajeAbierto.set(false);
  }

  protected async calcular(): Promise<void> {
    if (!this.km || this.km <= 0) return;
    this.error.set('');
    this.calculando.set(true);
    try {
      this.resultado.set(
        await this.store.estimarViaje({ km: this.km, ida_vuelta: this.idaVuelta, peajes: this.peajes }),
      );
    } catch (e) {
      this.resultado.set(null);
      const status = (e as HttpErrorResponse).status;
      this.error.set(
        status === 409
          ? 'Primero configura el rendimiento y el precio del combustible en "Ajustar".'
          : 'No se pudo calcular el viaje. Revisa los datos.',
      );
    } finally {
      this.calculando.set(false);
    }
  }

  protected limpiar(): void {
    this.resultado.set(null);
  }
}
