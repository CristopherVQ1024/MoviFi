import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-tarjeta-presupuesto',
  imports: [FormsModule, SolesPipe, DecimalPipe],
  templateUrl: './tarjeta-presupuesto.html',
  styleUrl: './tarjeta-presupuesto.scss',
})
export class TarjetaPresupuesto {
  protected store = inject(FinanzasStore);

  protected readonly mes = new Date().toLocaleDateString('es-PE', { month: 'long' });
  // circunferencia del anillo (r = 52)
  protected readonly circ = 2 * Math.PI * 52;

  protected editando = signal(false);
  protected guardando = signal(false);
  protected monto: number | null = null;

  // sugerencia: lo que sueles gastar al mes en combustible, redondeado hacia arriba a decenas
  protected sugerido(): number | null {
    const m = this.store.combustible()?.promedio_mensual;
    return m ? Math.ceil(m / 10) * 10 : null;
  }

  protected abrir(): void {
    this.monto = this.store.presupuesto().asignado || null;
    this.editando.set(true);
  }

  protected async guardar(): Promise<void> {
    if (this.monto == null || this.monto <= 0) return;
    this.guardando.set(true);
    try {
      await this.store.guardarPresupuesto(this.monto);
      this.editando.set(false);
    } finally {
      this.guardando.set(false);
    }
  }
}
