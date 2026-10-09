import { useEffect, useRef, useState } from 'preact/hooks';
import { getItem, type PetState } from '@kaplya/shared';
import { Shapes } from './Shapes';

export type PetEmotion = 'neutral' | 'happy' | 'sad' | 'sleep' | 'eating';

export const BODY_PATH =
  'M100 22 C112 22 128 50 148 82 C168 114 182 138 178 160 C174 182 150 192 100 192 ' +
  'C50 192 26 182 22 160 C18 138 32 114 52 82 C72 50 88 22 100 22 Z';

/** Точка рта в координатах viewBox — к ней тащат еду. */
export const MOUTH = { x: 100, y: 152 };
const EYES = [
  { x: 80, y: 118 },
  { x: 120, y: 118 },
];

interface Props {
  state: Pick<PetState, 'wear' | 'stats'>;
  emotion: PetEmotion;
  /** Открыть рот (еда рядом). */
  mouthOpen?: boolean;
  /** Следить глазами за касанием. */
  follow?: boolean;
  svgRef?: { current: SVGSVGElement | null };
  class?: string;
}

/** Переводит точку viewBox в экранные координаты. */
export function svgToClient(svg: SVGSVGElement, x: number, y: number) {
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function Pet({ state, emotion, mouthOpen, follow = true, svgRef, class: cls }: Props) {
  const ownRef = useRef<SVGSVGElement>(null);
  const ref = svgRef ?? ownRef;
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  // Моргание через случайные промежутки.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, 2200 + Math.random() * 3800);
    };
    loop();
    return () => clearTimeout(timer);
  }, []);

  // Зрачки тянутся к пальцу, но не дальше 6 единиц.
  useEffect(() => {
    if (!follow) return;
    const onMove = (e: PointerEvent) => {
      const svg = ref.current;
      if (!svg) return;
      const c = svgToClient(svg, 100, 118);
      const dx = e.clientX - c.x;
      const dy = e.clientY - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(6, d / 20) / d;
      setLook({ x: dx * k, y: dy * k });
    };
    const reset = () => setLook({ x: 0, y: 0 });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    document.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerleave', reset);
    };
  }, [follow]);

  const color = getItem(state.wear.color)?.color ?? '#7fd8be';
  const dirt = Math.max(0, Math.min(1, (55 - state.stats.hygiene) / 45));
  const sleeping = emotion === 'sleep';
  const sad = emotion === 'sad';
  const happy = emotion === 'happy';
  const eating = emotion === 'eating';
  const open = mouthOpen || eating;

  return (
    <svg ref={ref} class={`pet ${cls ?? ''} pet--${emotion}`} viewBox="0 0 200 200" role="img" aria-label="pet">
      <defs>
        <clipPath id="pet-body-clip">
          <path d={BODY_PATH} />
        </clipPath>
        <radialGradient id="pet-shine" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stop-color="#fff" stop-opacity="0.45" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="194" rx="62" ry="6" class="pet__shadow" />
      <g class="pet__body">
        <path d={BODY_PATH} fill={color} class="pet__skin" />
        <path d={BODY_PATH} fill="url(#pet-shine)" />
        <g clip-path="url(#pet-body-clip)">
          {dirt > 0 && (
            <g opacity={dirt} fill="#8d6e63">
              <ellipse cx="60" cy="150" rx="9" ry="6" />
              <ellipse cx="140" cy="100" rx="7" ry="5" />
              <ellipse cx="128" cy="172" rx="10" ry="6" />
              <circle cx="88" cy="70" r="5" />
            </g>
          )}
          <Shapes shapes={getItem(state.wear.outfit)?.svg} />
        </g>

        {(happy || eating) && (
          <g fill="#ff6b8b" opacity="0.45">
            <ellipse cx="58" cy="142" rx="10" ry="6" />
            <ellipse cx="142" cy="142" rx="10" ry="6" />
          </g>
        )}

        {sleeping ? (
          <g stroke="#2b2d42" stroke-width="4" fill="none" stroke-linecap="round">
            <path d="M67 120 Q80 128 93 120" />
            <path d="M107 120 Q120 128 133 120" />
          </g>
        ) : (
          <g class={`pet__eyes ${blink ? 'is-blink' : ''}`}>
            {EYES.map((e) => (
              <g key={e.x}>
                <circle cx={e.x} cy={e.y} r="15" fill="#fff" />
                <circle cx={e.x + look.x} cy={e.y + look.y + (sad ? 3 : 0)} r="7.5" fill="#2b2d42" />
                <circle cx={e.x + look.x + 3} cy={e.y + look.y - 3} r="2.5" fill="#fff" />
              </g>
            ))}
          </g>
        )}

        {sad && !sleeping && (
          <g stroke="#2b2d42" stroke-width="4" stroke-linecap="round">
            <path d="M66 96 L92 102" />
            <path d="M134 96 L108 102" />
          </g>
        )}

        <Mouth open={!!open} eating={eating} happy={happy} sad={sad} sleeping={sleeping} />
        <Shapes shapes={getItem(state.wear.glasses)?.svg} />
        <Shapes shapes={getItem(state.wear.hat)?.svg} />
      </g>
      {sleeping && (
        <g class="pet__zzz" fill="#6c63ff" font-weight="700" font-family="system-ui, sans-serif">
          <text x="150" y="60" font-size="18">z</text>
          <text x="164" y="42" font-size="22">z</text>
          <text x="180" y="22" font-size="26">Z</text>
        </g>
      )}
    </svg>
  );
}

function Mouth(p: { open: boolean; eating: boolean; happy: boolean; sad: boolean; sleeping: boolean }) {
  const ink = '#2b2d42';
  if (p.open) {
    return (
      <g class={p.eating ? 'pet__chew' : ''}>
        <ellipse cx={MOUTH.x} cy={MOUTH.y} rx="13" ry="11" fill={ink} />
        <ellipse cx={MOUTH.x} cy={MOUTH.y + 5} rx="7" ry="4" fill="#ff6b8b" />
      </g>
    );
  }
  if (p.sleeping) return <circle cx={MOUTH.x} cy={MOUTH.y} r="4" fill={ink} />;
  if (p.happy) {
    return (
      <g>
        <path d="M84 146 Q100 172 116 146 Z" fill={ink} stroke={ink} stroke-width="3" stroke-linejoin="round" />
        <ellipse cx="100" cy="158" rx="6" ry="3.5" fill="#ff6b8b" />
      </g>
    );
  }
  const d = p.sad ? 'M88 158 Q100 146 112 158' : 'M88 150 Q100 159 112 150';
  return <path d={d} fill="none" stroke={ink} stroke-width="4" stroke-linecap="round" />;
}
