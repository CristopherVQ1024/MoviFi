import { Routes } from '@angular/router';
import { authGuard, invitadoGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [invitadoGuard],
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    path: 'finanzas',
    canActivate: [authGuard],
    loadComponent: () => import('./finanzas/finanzas').then((m) => m.Finanzas),
  },
  { path: '**', redirectTo: '' },
];
