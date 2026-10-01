import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { AutoDeportivo } from '../shared/auto-deportivo';
import { Medidor } from '../shared/medidor';

@Component({
  selector: 'app-login',
  imports: [Medidor, AutoDeportivo],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);

  // posición del puntero normalizada (-1..1) para el efecto de profundidad
  protected px = signal(0);
  protected py = signal(0);

  protected cargando = signal(false);
  protected error = signal('');
  protected acelerando = signal(false);
  private encendido = signal(false);

  // Valor del medidor (0-100): arranca en 0, sube al cargar, reacciona al puntero y al botón.
  protected valor = computed(() => {
    if (this.cargando() || this.acelerando()) return 97;
    if (!this.encendido()) return 0;
    return Math.round(78 + this.px() * 12);
  });

  constructor() {
    setTimeout(() => this.encendido.set(true), 500);
  }

  protected mover(e: PointerEvent): void {
    this.px.set((e.clientX / window.innerWidth - 0.5) * 2);
    this.py.set((e.clientY / window.innerHeight - 0.5) * 2);
  }

  protected reposo(): void {
    this.px.set(0);
    this.py.set(0);
  }

  protected async entrar(): Promise<void> {
    this.error.set('');
    this.cargando.set(true);
    try {
      await this.auth.loginConGoogle();
      await this.router.navigate(['/finanzas']);
    } catch (e) {
      const cerrado = (e as { code?: string }).code?.includes('popup-closed');
      this.error.set(
        cerrado ? 'Cerraste la ventana antes de terminar.' : 'No pudimos iniciar sesión. Intenta de nuevo.',
      );
    } finally {
      this.cargando.set(false);
    }
  }
}
