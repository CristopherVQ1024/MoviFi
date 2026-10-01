import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { ChatWidget } from './chat-widget';
import { CombustibleForm } from './combustible-form';
import { FinanzasStore } from './finanzas.store';
import { GastoForm } from './gasto-form';
import { GraficoGastos } from './grafico-gastos';
import { HeroVehiculo } from './hero-vehiculo';
import { ListaGastos } from './lista-gastos';
import { PanelMantenimientos } from './panel-mantenimientos';
import { TarjetaCopiloto } from './tarjeta-copiloto';
import { TarjetaLibre } from './tarjeta-libre';
import { TarjetaNotas } from './tarjeta-notas';
import { TarjetaPresupuesto } from './tarjeta-presupuesto';
import { VehiculoForm } from './vehiculo-form';
import { ViajeForm } from './viaje-form';

@Component({
  selector: 'app-finanzas',
  imports: [
    HeroVehiculo,
    TarjetaCopiloto,
    TarjetaLibre,
    TarjetaNotas,
    TarjetaPresupuesto,
    GraficoGastos,
    PanelMantenimientos,
    ListaGastos,
    GastoForm,
    CombustibleForm,
    ViajeForm,
    ChatWidget,
    VehiculoForm,
  ],
  providers: [FinanzasStore],
  templateUrl: './finanzas.html',
  styleUrl: './finanzas.scss',
})
export class Finanzas {
  protected auth = inject(AuthService);
  protected store = inject(FinanzasStore);

  constructor() {
    this.store.iniciar();
  }

  protected nuevoGasto(): void {
    this.store.formularioGasto.set({});
  }
}
