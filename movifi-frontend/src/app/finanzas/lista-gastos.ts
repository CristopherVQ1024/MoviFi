import { Component, inject, signal } from '@angular/core';
import { FechaCortaPipe, SolesPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-lista-gastos',
  imports: [SolesPipe, FechaCortaPipe],
  templateUrl: './lista-gastos.html',
  styleUrl: './lista-gastos.scss',
})
export class ListaGastos {
  protected store = inject(FinanzasStore);
  // un primer clic arma el borrado, el segundo lo confirma
  protected porBorrar = signal<number | null>(null);

  protected async borrar(id: number): Promise<void> {
    if (this.porBorrar() !== id) {
      this.porBorrar.set(id);
      setTimeout(() => this.porBorrar() === id && this.porBorrar.set(null), 3000);
      return;
    }
    this.porBorrar.set(null);
    await this.store.eliminarGasto(id);
  }
}
