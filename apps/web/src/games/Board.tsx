import { winningLine } from '@kaplya/shared';

const CELL = 100;
const center = (i: number) => ({ x: (i % 3) * CELL + CELL / 2, y: Math.floor(i / 3) * CELL + CELL / 2 });

/** Поле 3×3 в SVG. Метки рисуются анимацией обводки. */
export function Board({ board, disabled, onCell }: { board: string; disabled?: boolean; onCell: (i: number) => void }) {
  const line = winningLine(board);
  return (
    <svg class="ttt-board" viewBox="-6 -6 312 312" role="grid">
      <g class="ttt-grid">
        <path d="M100 8 V292 M200 8 V292 M8 100 H292 M8 200 H292" />
      </g>
      {[...board].map((c, i) => {
        const p = center(i);
        return (
          <g key={i} role="gridcell" aria-label={c === '.' ? `${i + 1}` : c}>
            <rect
              x={p.x - 48}
              y={p.y - 48}
              width="96"
              height="96"
              class={`ttt-cell ${c === '.' && !disabled ? 'is-free' : ''}`}
              onClick={() => c === '.' && !disabled && onCell(i)}
            />
            {c === 'X' && (
              <path class="ttt-x" d={`M${p.x - 28} ${p.y - 28} L${p.x + 28} ${p.y + 28} M${p.x + 28} ${p.y - 28} L${p.x - 28} ${p.y + 28}`} />
            )}
            {c === 'O' && <circle class="ttt-o" cx={p.x} cy={p.y} r="30" />}
          </g>
        );
      })}
      {line && (
        <line
          class="ttt-win"
          x1={center(line[0]).x}
          y1={center(line[0]).y}
          x2={center(line[2]).x}
          y2={center(line[2]).y}
        />
      )}
    </svg>
  );
}
