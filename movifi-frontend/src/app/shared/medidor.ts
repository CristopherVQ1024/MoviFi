import { Component, computed, input } from '@angular/core';

const CENTRO = 200;
const ARCO = 120; // el medidor va de -120° a +120° respecto a la vertical

function punto(grados: number, radio: number): [number, number] {
  const r = (grados * Math.PI) / 180;
  return [CENTRO + radio * Math.sin(r), CENTRO - radio * Math.cos(r)];
}

const MARCAS = Array.from({ length: 51 }, (_, i) => {
  const a = -ARCO + (i / 50) * ARCO * 2;
  const mayor = i % 5 === 0;
  const [x1, y1] = punto(a, mayor ? 148 : 156);
  const [x2, y2] = punto(a, 166);
  return { x1, y1, x2, y2, mayor };
});

const ETIQUETAS = Array.from({ length: 11 }, (_, i) => {
  const [x, y] = punto(-ARCO + (i / 10) * ARCO * 2, 128);
  return { x, y, texto: i * 10 };
});

const [AX, AY] = punto(-ARCO, 176);
const [BX, BY] = punto(ARCO, 176);

@Component({
  selector: 'app-medidor',
  templateUrl: './medidor.html',
  styleUrl: './medidor.scss',
})
export class Medidor {
  readonly valor = input(0);
  readonly etiqueta = input('SALUD DEL AUTO');
  readonly sufijo = input('%');

  protected readonly marcas = MARCAS;
  protected readonly etiquetas = ETIQUETAS;
  protected readonly arcoPath = `M ${AX} ${AY} A 176 176 0 1 1 ${BX} ${BY}`;
  protected readonly angulo = computed(() => -ARCO + (this.valor() / 100) * ARCO * 2);
}
