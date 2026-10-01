import { Component, inject } from '@angular/core';
import { FinanzasStore } from './finanzas.store';

@Component({
  selector: 'app-tarjeta-copiloto',
  templateUrl: './tarjeta-copiloto.html',
  styleUrl: './tarjeta-copiloto.scss',
})
export class TarjetaCopiloto {
  protected store = inject(FinanzasStore);
}
