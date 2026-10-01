import { isDevMode } from '@angular/core';

// En desarrollo el backend corre aparte (:3000); en producción un proxy lo expone en el mismo dominio, bajo /api.
export const API_URL = isDevMode() ? 'http://localhost:3000' : '/api';

// Configuración web de Firebase: es pública por diseño, no es un secreto.
export const firebaseConfig = {
  apiKey: 'AIzaSyCqc6ZCTAN3D-0qI0NrwpV5um4TOnCZOKM',
  authDomain: 'movifi-68dfc.firebaseapp.com',
  projectId: 'movifi-68dfc',
  appId: '1:170919081659:web:6b89cf50a282a01d771b9e',
};
