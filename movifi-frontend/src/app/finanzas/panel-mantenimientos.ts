import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TipoMantenimiento } from '../core/api.service';
import { FechaCortaPipe, hoyISO } from '../shared/formato';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-panel-mantenimientos',
  imports: [FormsModule, FechaCortaPipe],
  templateUrl: './panel-mantenimientos.html',
  styleUrl: './panel-mantenimientos.scss',
})
export class PanelMantenimientos {
  protected store = inject(FinanzasStore);
  protected readonly hoy = hoyISO();

  // tipos del catálogo que aún no se están siguiendo (se excluye "Otro")
  protected disponibles = computed(() => {
    const activos = new Set(this.store.mantenimientos().map((m) => m.tipo_mantenimiento_id));
    return this.store.tipos().filter((t) => !activos.has(t.id) && t.nombre !== 'Otro');
  });

  // formulario "¿cuándo fue la última vez?" para el tipo que se empieza a seguir (o se completa)
  protected configurando = signal<TipoMantenimiento | null>(null);
  protected fecha = '';
  protected km: number | null = null;
  protected guardando = signal(false);
  protected error = signal('');

  protected frecuencia(t: TipoMantenimiento): string {
    const partes = [
      t.frecuencia_km_sugerida ? `${t.frecuencia_km_sugerida.toLocaleString('es-PE')} km` : '',
      t.frecuencia_meses_sugerida ? (t.frecuencia_meses_sugerida === 12 ? '1 año' : `${t.frecuencia_meses_sugerida} meses`) : '',
    ].filter(Boolean);
    return partes.length ? `Cada ${partes.join(' o ')}, lo que ocurra primero.` : '';
  }

  // "en 6 meses", "en 1 año y 2 meses": deja claro cuánto falta aunque la fecha caiga en otro año
  protected plazo(dias: number): string {
    const meses = Math.round(dias / 30.4);
    if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
    const anios = Math.floor(meses / 12);
    const resto = meses % 12;
    return `${anios} ${anios === 1 ? 'año' : 'años'}${resto ? ` y ${resto} ${resto === 1 ? 'mes' : 'meses'}` : ''}`;
  }

  protected registrar(tipoId: number): void {
    this.store.formularioGasto.set({ tipoMantId: tipoId });
  }

  protected abrir(tipoId: number): void {
    const tipo = this.store.tipos().find((t) => t.id === tipoId) ?? null;
    this.fecha = '';
    this.km = null;
    this.error.set('');
    this.configurando.set(tipo);
  }

  protected async guardar(conDatos: boolean): Promise<void> {
    const tipo = this.configurando();
    if (!tipo) return;
    if (conDatos && !this.fecha) {
      this.error.set('Pon la fecha de la última vez, o elige "No lo sé".');
      return;
    }
    this.error.set('');
    this.guardando.set(true);
    try {
      await this.store.activarMantenimiento(tipo.id, conDatos ? { ultima_fecha: this.fecha, ultimo_km: this.km } : undefined);
      this.configurando.set(null);
    } catch {
      this.error.set('No se pudo guardar. Revisa la fecha (no puede ser futura).');
    } finally {
      this.guardando.set(false);
    }
  }
}
