import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AutoDeportivo } from '../shared/auto-deportivo';
import { Medidor } from '../shared/medidor';
import { TanqueCombustible } from './tanque-combustible';
import { FechaCortaPipe, SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-hero-vehiculo',
  imports: [FormsModule, DecimalPipe, Medidor, AutoDeportivo, SolesPipe, FechaCortaPipe, TanqueCombustible],
  templateUrl: './hero-vehiculo.html',
  styleUrl: './hero-vehiculo.scss',
})
export class HeroVehiculo {
  protected store = inject(FinanzasStore);

  protected px = signal(0);
  protected py = signal(0);
  protected editando = signal(false);
  protected guardando = signal(false);
  protected nuevoKm: number | null = null;
  // un primer clic arma el reinicio del recorrido, el segundo lo confirma
  protected confirmarReinicio = signal(false);

  protected async reiniciarRecorrido(): Promise<void> {
    if (!this.confirmarReinicio()) {
      this.confirmarReinicio.set(true);
      setTimeout(() => this.confirmarReinicio.set(false), 3000);
      return;
    }
    this.confirmarReinicio.set(false);
    await this.store.reiniciarRecorrido();
  }

  // odómetro de 6 dígitos
  protected digitos = computed(() =>
    String(this.store.vehiculo()?.km_actual ?? 0)
      .padStart(6, '0')
      .split(''),
  );

  protected mover(e: PointerEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.px.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    this.py.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  }

  protected reposo(): void {
    this.px.set(0);
    this.py.set(0);
  }

  protected abrirEdicion(): void {
    this.nuevoKm = this.store.vehiculo()?.km_actual ?? 0;
    this.editando.set(true);
  }

  protected async guardarKm(): Promise<void> {
    if (this.nuevoKm == null || this.nuevoKm < 0) return;
    this.guardando.set(true);
    try {
      await this.store.actualizarKm(this.nuevoKm);
      this.editando.set(false);
    } finally {
      this.guardando.set(false);
    }
  }
}
