import { Component, computed, inject, signal } from '@angular/core';
import { SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

const R = 70;
const CIRC = 2 * Math.PI * R;

@Component({
  selector: 'app-grafico-gastos',
  imports: [SolesPipe],
  templateUrl: './grafico-gastos.html',
  styleUrl: './grafico-gastos.scss',
})
export class GraficoGastos {
  protected store = inject(FinanzasStore);
  protected readonly r = R;
  protected activa = signal<string | null>(null);

  protected total = computed(() => this.store.categorias().reduce((s, c) => s + c.total, 0));

  // cada segmento es un círculo con dasharray; el offset acumulado lo coloca tras el anterior
  protected segmentos = computed(() => {
    let acum = 0;
    return this.store.categorias().map((c) => {
      const largo = Math.max(c.pct * CIRC - 3, 0);
      const seg = { ...c, dash: `${largo} ${CIRC}`, offset: -acum };
      acum += c.pct * CIRC;
      return seg;
    });
  });

  protected foco = computed(() => this.store.categorias().find((c) => c.nombre === this.activa()) ?? null);
}
