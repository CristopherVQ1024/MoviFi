import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Veredicto } from '../core/api.service';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-tarjeta-libre',
  imports: [FormsModule, SolesPipe],
  templateUrl: './tarjeta-libre.html',
  styleUrl: './tarjeta-libre.scss',
})
export class TarjetaLibre {
  protected store = inject(FinanzasStore);

  protected monto: number | null = null;
  protected consultando = signal(false);
  protected resultado = signal<Veredicto | null>(null);

  protected libreVisible = computed(() => Math.max(this.store.libre()?.libre ?? 0, 0));

  // tramos de la barra: cuánto de lo disponible está libre y cuánto ya está comprometido
  protected tramos = computed(() => {
    const l = this.store.libre();
    if (!l || l.disponible <= 0) return [];
    const base = Math.max(l.disponible, l.combustible_pendiente + l.mantenimientos_total + l.imprevistos);
    return [
      { nombre: 'Libre', valor: Math.max(l.libre, 0), clase: 'libre' },
      { nombre: 'Combustible que falta', valor: l.combustible_pendiente, clase: 'comb' },
      { nombre: 'Mantenimientos del mes', valor: l.mantenimientos_total, clase: 'mant' },
      { nombre: 'Imprevistos (10%)', valor: l.imprevistos, clase: 'imp' },
    ].map((t) => ({ ...t, pct: (t.valor / base) * 100 }));
  });

  protected async consultar(): Promise<void> {
    if (!this.monto || this.monto <= 0) return;
    this.consultando.set(true);
    try {
      this.resultado.set(await this.store.meAlcanza(this.monto));
    } finally {
      this.consultando.set(false);
    }
  }

  protected limpiar(): void {
    this.resultado.set(null);
  }
}
