import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from 'firebase/auth';
import { firstValueFrom } from 'rxjs';
import { API_URL, firebaseConfig } from '../config';

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  foto_url: string | null;
}

const TOKEN_KEY = 'movifi_token';
const USER_KEY = 'movifi_usuario';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private firebaseAuth = getAuth(initializeApp(firebaseConfig));

  readonly usuario = signal<Usuario | null>(this.leerUsuario());
  readonly autenticado = computed(() => this.usuario() !== null && this.token !== null);

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  // Google (vía Firebase) entrega un id_token; el backend lo valida y responde con su propio JWT.
  async loginConGoogle(): Promise<void> {
    const resultado = await signInWithPopup(this.firebaseAuth, new GoogleAuthProvider());
    const idToken = GoogleAuthProvider.credentialFromResult(resultado)?.idToken;
    if (!idToken) throw new Error('Google no devolvió id_token');
    const res = await firstValueFrom(
      this.http.post<{ token: string; usuario: Usuario }>(`${API_URL}/auth/google`, {
        id_token: idToken,
      }),
    );
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.usuario));
    this.usuario.set(res.usuario);
  }

  async cerrarSesion(): Promise<void> {
    this.limpiar();
    await signOut(this.firebaseAuth).catch(() => {});
    await this.router.navigate(['/']);
  }

  // Token vencido o inválido: se limpia y se vuelve al login.
  sesionExpirada(): void {
    this.limpiar();
    this.router.navigate(['/']);
  }

  private limpiar(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.usuario.set(null);
  }

  private leerUsuario(): Usuario | null {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
    } catch {
      return null;
    }
  }
}
