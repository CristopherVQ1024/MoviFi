import { Pipe, PipeTransform } from '@angular/core';

export const COLORES_CATEGORIA = ['#3ad6ff', '#4d7cff', '#ffb347', '#ff6f8e', '#4ae3b5', '#a78bfa'];

export function colorDeCategoria(nombre: string): string {
  let h = 0;
  for (const c of nombre.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES_CATEGORIA[h % COLORES_CATEGORIA.length];
}

export function hoyISO(): string {
  return new Date().toLocaleDateString('en-CA');
}

// las fechas llegan como AAAA-MM-DD: se leen como fecha local para que ninguna zona horaria las corra un dia
export function parseFecha(fecha: string): Date {
  if (fecha.length > 10) return new Date(fecha); // instante con hora (notas): se muestra en hora local
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(fecha);
}

export function diasHasta(fecha: string | null): number | null {
  if (!fecha) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((parseFecha(fecha).getTime() - hoy.getTime()) / 86_400_000);
}

@Pipe({ name: 'soles' })
export class SolesPipe implements PipeTransform {
  transform(valor: number | null | undefined, decimales = 0): string {
    const n = valor ?? 0;
    return 'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  }
}

// "30 sep" (o "30 sep 2025" si no es de este año)
@Pipe({ name: 'fechaCorta' })
export class FechaCortaPipe implements PipeTransform {
  transform(fecha: string | null | undefined): string {
    if (!fecha) return '—';
    const d = parseFecha(fecha);
    const otroAnio = d.getFullYear() !== new Date().getFullYear();
    return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', ...(otroAnio ? { year: 'numeric' } : {}) });
  }
}

// "30 de septiembre de 2026"
@Pipe({ name: 'fechaLarga' })
export class FechaLargaPipe implements PipeTransform {
  transform(fecha: string | null | undefined): string {
    if (!fecha) return '—';
    return parseFecha(fecha).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
  }
}
