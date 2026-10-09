import { h } from 'preact';
import type { SvgShape } from '@kaplya/shared';

const ALLOWED = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'line']);

/** Рисует фигуры предмета из каталога (только безопасный набор SVG-тегов). */
export function Shapes({ shapes }: { shapes?: SvgShape[] }) {
  if (!shapes) return null;
  return <>{shapes.filter((s) => ALLOWED.has(s.el)).map((s, i) => h(s.el, { key: i, ...s.a }))}</>;
}
