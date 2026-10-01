import { Component, input } from '@angular/core';

@Component({
  selector: 'app-auto-deportivo',
  templateUrl: './auto-deportivo.html',
  styleUrl: './auto-deportivo.scss',
  host: { '[class.rapido]': 'rapido()' },
})
export class AutoDeportivo {
  // acelera las ruedas y el haz del faro
  readonly rapido = input(false);
}
