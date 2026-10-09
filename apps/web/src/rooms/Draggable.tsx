import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { haptic } from '../telegram';

interface Props {
  children: ComponentChildren;
  label: string;
  disabled?: boolean;
  onMove?: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
}

/** Предмет на полке, который можно тащить пальцем. Пока тащим — рисуется копия под пальцем. */
export function Draggable({ children, label, disabled, onMove, onDrop }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const down = (e: PointerEvent) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    haptic.tap();
    setPos({ x: e.clientX, y: e.clientY });
  };
  const move = (e: PointerEvent) => {
    if (!pos) return;
    setPos({ x: e.clientX, y: e.clientY });
    onMove?.(e.clientX, e.clientY);
  };
  const up = (e: PointerEvent) => {
    if (!pos) return;
    setPos(null);
    onDrop(e.clientX, e.clientY);
  };
  const cancel = () => {
    if (!pos) return;
    setPos(null);
    onDrop(NaN, NaN);
  };

  return (
    <>
      <button
        type="button"
        class={`drag-item ${pos ? 'is-dragging' : ''}`}
        aria-label={label}
        disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
      >
        {children}
      </button>
      {pos && (
        <div class="drag-ghost" style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
          {children}
        </div>
      )}
    </>
  );
}
