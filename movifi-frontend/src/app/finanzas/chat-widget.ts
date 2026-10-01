import { AfterViewChecked, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { FinanzasStore } from './finanzas.store';

interface Mensaje {
  de: 'yo' | 'ia';
  texto: string;
}

@Component({
  selector: 'app-chat-widget',
  imports: [FormsModule],
  templateUrl: './chat-widget.html',
  styleUrl: './chat-widget.scss',
})
export class ChatWidget implements AfterViewChecked {
  private api = inject(ApiService);
  private store = inject(FinanzasStore);

  protected abierto = signal(false);
  protected pensando = signal(false);
  protected texto = '';
  protected mensajes = signal<Mensaje[]>([
    { de: 'ia', texto: 'Habla, soy tu copiloto. Pregúntame por tu presupuesto, tus gastos o qué mantenimiento te toca.' },
  ]);
  protected readonly sugerencias = ['¿Cuánto me queda del presupuesto?', '¿Qué mantenimiento me toca?', '¿Cuánto me cuesta cada km?'];

  private lista = viewChild<ElementRef<HTMLElement>>('lista');
  private bajar = false;

  ngAfterViewChecked(): void {
    const el = this.lista()?.nativeElement;
    if (el && this.bajar) {
      el.scrollTop = el.scrollHeight;
      this.bajar = false;
    }
  }

  protected async enviar(pregunta = this.texto): Promise<void> {
    const mensaje = pregunta.trim();
    const v = this.store.vehiculo();
    if (!mensaje || !v || this.pensando()) return;
    this.texto = '';
    this.mensajes.update((m) => [...m, { de: 'yo', texto: mensaje }]);
    this.pensando.set(true);
    this.bajar = true;
    try {
      const r = await this.api.chat(v.id, mensaje);
      this.mensajes.update((m) => [...m, { de: 'ia', texto: r.respuesta }]);
    } catch (e) {
      const saturado = (e as { status?: number }).status === 429;
      this.mensajes.update((m) => [
        ...m,
        {
          de: 'ia',
          texto: saturado
            ? 'Me pasé del límite de consultas de la IA. Dame un minuto y vuelve a preguntarme.'
            : 'Se me cruzaron los cables. Intenta de nuevo en un momento.',
        },
      ]);
    } finally {
      this.pensando.set(false);
      this.bajar = true;
    }
  }
}
