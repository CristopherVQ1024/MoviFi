import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../config';

export interface Vehiculo {
  id: number;
  placa: string | null;
  km_actual: number;
  marca: string;
  modelo: string;
  anio: number;
  tipo_combustible: string | null;
  rendimiento_km_por_galon: string | null;
  combustible_grado: string | null;
  rendimiento_manual: string | null;
  precio_galon: string | null;
  km_inicial: number | null;
  combustible_mensual: string | null;
  capacidad_tanque_galones: string | null;
  capacidad_manual: string | null;
  nivel_combustible: string | null;
  km_nivel: number | null;
}

export const GRADOS_COMBUSTIBLE = ['Regular 90', 'Premium 95', 'Premium 97', 'Diésel', 'GLP', 'GNV'];

export interface Tanque {
  capacidad_galones: number | null;
  capacidad_origen: 'manual' | 'ia';
  galones_por_barra: number | null;
  costo_por_barra: number | null;
  nivel: number | null;
  galones: number | null;
  autonomia_km: number | null;
  actualizado: string | null;
  km_nivel: number | null;
}

export interface Odometro {
  registrado: number;
  extra: number;
  estimado: number;
  actualizado: string | null;
  parcial: { km: number; desde: string };
}

export interface Nota {
  id: number;
  texto: string;
  fecha: string;
  actualizada: string | null;
}

export interface Tramo {
  barras: number;
  galones: number;
  costo: number | null;
  km_recorridos: number | null;
  rendimiento: number | null;
  km_estimados: number | null;
}

export interface ResultadoNivel {
  nivel: number;
  tramo: Tramo | null;
  subio: { barras: number; galones: number; monto_estimado: number | null } | null;
  tanque: Tanque;
  odometro: Odometro;
}

export interface Viaje {
  km_total: number;
  galones: number;
  barras: number | null;
  costo_combustible: number;
  peajes: number;
  total: number;
  con_tanque_actual: {
    alcanza: boolean;
    autonomia_km: number;
    galones_a_cargar: number;
    monto_a_cargar: number;
  } | null;
  veredicto: { veredicto: 'si' | 'justo' | 'no' | 'sin-presupuesto'; sobra?: number; faltan?: number; usa_colchon?: number };
}

export interface Combustible {
  tanque: Tanque;
  rendimiento_real: { valor: number; tramos: number } | null;
  grado: string | null;
  precio_galon: number | null;
  rendimiento_km_por_galon: number | null;
  rendimiento_origen: 'manual' | 'ia';
  costo_por_km: number | null;
  promedio_mensual: number | null;
  promedio_por_carga: number | null;
  km_por_carga: number | null;
  cargas: number;
}

export interface Libre {
  definido: boolean;
  asignado: number;
  gastado: number;
  disponible: number;
  combustible_base: number | null;
  combustible_origen: 'declarado' | 'historial' | 'sin-datos';
  combustible_gastado: number;
  combustible_pendiente: number;
  mantenimientos: { nombre: string; costo_estimado: number; estimado: boolean }[];
  mantenimientos_total: number;
  imprevistos: number;
  libre: number;
}

export interface Veredicto {
  veredicto: 'si' | 'justo' | 'no' | 'sin-presupuesto';
  monto: number;
  sobra?: number;
  faltan?: number;
  usa_colchon?: number;
  libre: Libre;
}

export interface Copiloto {
  texto: string;
  fuente: 'ia' | 'reglas';
  alertas: { nivel: 'alto' | 'medio' | 'ok' | 'info'; texto: string }[];
}

export interface Mantenimiento {
  id: number;
  tipo_mantenimiento_id: number;
  nombre: string;
  activo: boolean;
  ultima_fecha: string | null;
  ultimo_km: number | null;
  proxima_fecha: string | null;
  proximo_km: number | null;
}

export interface TipoMantenimiento {
  id: number;
  nombre: string;
  frecuencia_km_sugerida: number | null;
  frecuencia_meses_sugerida: number | null;
}

export interface Gasto {
  id: number;
  tipo: 'programado' | 'no_programado';
  categoria: string | null;
  monto: string;
  descripcion: string | null;
  fecha: string;
  tipo_mantenimiento_id: number | null;
}

export interface Dashboard {
  presupuesto: { asignado: string | number; gastado: string | number };
  gastos_por_categoria: { categoria: string | null; total: string }[];
  proximos_mantenimientos: Mantenimiento[];
  costo_por_km: number | null;
  combustible: Combustible;
  libre: Libre;
  odometro: Odometro;
}

export interface NuevoGasto {
  tipo: 'programado' | 'no_programado';
  categoria: string;
  monto: number;
  descripcion: string;
  fecha: string;
  tipo_mantenimiento_id?: number | null;
  km?: number | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  private get<T>(ruta: string) {
    return firstValueFrom(this.http.get<T>(`${API_URL}${ruta}`));
  }
  private post<T>(ruta: string, cuerpo: unknown) {
    return firstValueFrom(this.http.post<T>(`${API_URL}${ruta}`, cuerpo));
  }
  private patch<T>(ruta: string, cuerpo: unknown) {
    return firstValueFrom(this.http.patch<T>(`${API_URL}${ruta}`, cuerpo));
  }
  private delete<T>(ruta: string) {
    return firstValueFrom(this.http.delete<T>(`${API_URL}${ruta}`));
  }

  vehiculos = () => this.get<Vehiculo[]>('/vehiculos');
  crearVehiculo = (d: { marca: string; modelo: string; anio: number; placa: string; combustible_grado: string }) =>
    this.post<unknown>('/vehiculos', d);
  actualizarVehiculo = (
    id: number,
    d: {
      km_actual?: number;
      placa?: string;
      combustible_grado?: string;
      rendimiento_manual?: number | null;
      precio_galon?: number | null;
      combustible_mensual?: number | null;
      capacidad_manual?: number | null;
    },
  ) =>
    this.patch<unknown>(`/vehiculos/${id}`, d);

  tipos = () => this.get<TipoMantenimiento[]>('/tipos-mantenimiento');
  mantenimientos = (id: number) => this.get<Mantenimiento[]>(`/vehiculos/${id}/mantenimientos`);
  activarMantenimiento = (id: number, tipoId: number, ultima?: { ultima_fecha?: string; ultimo_km?: number | null }) =>
    this.post<unknown>(`/vehiculos/${id}/mantenimientos`, { tipo_mantenimiento_id: tipoId, ...ultima });
  quitarMantenimiento = (id: number) => this.delete<unknown>(`/mantenimientos/${id}`);

  dashboard = (id: number) => this.get<Dashboard>(`/vehiculos/${id}/dashboard`);
  guardarPresupuesto = (id: number, mes: string, monto: number) =>
    this.post<unknown>(`/vehiculos/${id}/presupuesto`, { mes, monto_asignado: monto });

  gastos = (id: number) => this.get<Gasto[]>(`/vehiculos/${id}/gastos`);
  crearGasto = (id: number, g: NuevoGasto) => this.post<unknown>(`/vehiculos/${id}/gastos`, g);
  eliminarGasto = (id: number) => this.delete<unknown>(`/gastos/${id}`);

  fijarNivel = (id: number, d: { nivel: number; km?: number | null; monto?: number | null; nivel_antes?: number | null }) =>
    firstValueFrom(this.http.put<ResultadoNivel>(`${API_URL}/vehiculos/${id}/nivel-combustible`, d));
  estimarViaje = (id: number, d: { km: number; ida_vuelta: boolean; peajes: number | null }) =>
    this.post<Viaje>(`/vehiculos/${id}/estimar-viaje`, d);

  notas = (id: number) => this.get<Nota[]>(`/vehiculos/${id}/notas`);
  crearNota = (id: number, texto: string) => this.post<Nota>(`/vehiculos/${id}/notas`, { texto });
  editarNota = (id: number, texto: string) => this.patch<Nota>(`/notas/${id}`, { texto });
  borrarNota = (id: number) => this.delete<unknown>(`/notas/${id}`);

  reiniciarRecorrido = (id: number) => this.post<Odometro>(`/vehiculos/${id}/recorrido/reiniciar`, {});

  copiloto = (id: number) => this.get<Copiloto>(`/vehiculos/${id}/copiloto`);
  meAlcanza = (id: number, monto: number) => this.post<Veredicto>(`/vehiculos/${id}/me-alcanza`, { monto });

  chat = (id: number, mensaje: string) =>
    this.post<{ respuesta: string }>(`/vehiculos/${id}/chat`, { mensaje });
}
