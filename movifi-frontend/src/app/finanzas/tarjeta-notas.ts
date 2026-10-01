import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Nota } from '../core/api.service';
import { FechaCortaPipe } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

const MAX = 1000;

@Component({
  selector: 'app-tarjeta-notas',
  imports: [FormsModule, FechaCortaPipe],
  templateUrl: './tarjeta-notas.html',
  styleUrl: './tarjeta-notas.scss',
})
export class TarjetaNotas {
  protected store = inject(FinanzasStore);
  protected readonly max = MAX;

  protected texto = '';
  protected textoEdit = '';
  protected guardando = signal(false);
  protected editando = signal<number | null>(null);
  protected error = signal('');
  // un primer clic arma el borrado, el segundo lo confirma
  protected porBorrar = signal<number | null>(null);

  protected async agregar(): Promise<void> {
    const t = this.texto.trim();
    if (!t) return;
    await this.ejecutar(async () => {
      await this.store.agregarNota(t);
      this.texto = '';
    });
  }

  protected editar(n: Nota): void {
    this.error.set('');
    this.textoEdit = n.texto;
    this.editando.set(n.id);
  }

  protected async guardarEdicion(id: number): Promise<void> {
    const t = this.textoEdit.trim();
    if (!t) return;
    await this.ejecutar(async () => {
      await this.store.editarNota(id, t);
      this.editando.set(null);
    });
  }

  protected async borrar(id: number): Promise<void> {
    if (this.porBorrar() !== id) {
      this.porBorrar.set(id);
      setTimeout(() => this.porBorrar() === id && this.porBorrar.set(null), 3000);
      return;
    }
    this.porBorrar.set(null);
    await this.ejecutar(() => this.store.borrarNota(id));
  }

  private async ejecutar(accion: () => Promise<unknown>): Promise<void> {
    this.error.set('');
    this.guardando.set(true);
    try {
      await accion();
    } catch (e) {
      this.error.set((e as HttpErrorResponse).error?.error ?? 'No se pudo guardar la nota. Intenta de nuevo.');
    } finally {
      this.guardando.set(false);
    }
  }
}
