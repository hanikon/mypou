import { signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { Draggable } from './Draggable';
import { feed, itemsBySlot, MIN_ENERGY_TO_PLAY, play, setSleeping, wash } from '@kaplya/shared';
import { lang, t } from '../i18n';
import { MOUTH, svgToClient } from '../pet/Pet';
import { Shapes } from '../pet/Shapes';
import { sfx } from '../sfx';
import { act, flashEmotion, overlay, pet, showToast } from '../state/store';
import { haptic } from '../telegram';

/** Ссылка на SVG питомца на сцене — нужна, чтобы знать, где рот. */
export const petSvg: { current: SVGSVGElement | null } = { current: null };
export const mouthOpen = signal(false);
export const bubbles = signal<{ id: number; x: number; y: number }[]>([]);
export const jumping = signal(false);

const distToMouth = (x: number, y: number) => {
  if (!petSvg.current) return Infinity;
  const m = svgToClient(petSvg.current, MOUTH.x, MOUTH.y);
  return Math.hypot(x - m.x, y - m.y);
};

export function KitchenTray() {
  const p = pet.value!;
  const foods = itemsBySlot('food').filter((f) => (p.food[f.id] ?? 0) > 0);
  if (foods.length === 0) {
    return (
      <div class="tray">
        <span class="tray__hint">{t().kitchen.empty}</span>
        <button class="btn" onClick={() => (overlay.value = { kind: 'shop', tab: 'food' })}>
          {t().kitchen.buyFood}
        </button>
      </div>
    );
  }
  return (
    <div class="tray">
      <span class="tray__hint">{t().kitchen.hint}</span>
      <div class="tray__items">
        {foods.map((f) => (
          <Draggable
            key={f.id}
            label={f.name[lang.value]}
            onMove={(x, y) => (mouthOpen.value = distToMouth(x, y) < 110)}
            onDrop={(x, y) => {
              mouthOpen.value = false;
              if (!(distToMouth(x, y) < 70)) return;
              if (act((s, now) => feed(s, f.id, now))) {
                sfx.chomp();
                haptic.success();
                flashEmotion('eating');
              }
            }}
          >
            <svg viewBox="0 0 40 40" class="food-icon">
              <Shapes shapes={f.svg} />
            </svg>
            <span class="badge">{p.food[f.id]}</span>
          </Draggable>
        ))}
      </div>
    </div>
  );
}

let bubbleId = 0;

export function BathroomTray() {
  const rubbed = useRef({ dist: 0, last: null as { x: number; y: number } | null, sinceBubble: 0 });

  const overPet = (x: number, y: number) => {
    const r = petSvg.current?.getBoundingClientRect();
    return !!r && x > r.left && x < r.right && y > r.top && y < r.bottom;
  };

  return (
    <div class="tray">
      <span class="tray__hint">{t().bathroom.hint}</span>
      <div class="tray__items">
        <Draggable
          label={t().bathroom.soap}
          onMove={(x, y) => {
            const r = rubbed.current;
            if (!overPet(x, y)) {
              r.last = null;
              return;
            }
            if (r.last) {
              const d = Math.hypot(x - r.last.x, y - r.last.y);
              r.dist += d;
              r.sinceBubble += d;
            }
            r.last = { x, y };
            if (r.sinceBubble > 35) {
              r.sinceBubble = 0;
              const id = ++bubbleId;
              bubbles.value = [...bubbles.value.slice(-20), { id, x, y }];
              setTimeout(() => (bubbles.value = bubbles.value.filter((b) => b.id !== id)), 1100);
              haptic.select();
            }
          }}
          onDrop={() => {
            const r = rubbed.current;
            const amount = Math.min(60, Math.round(r.dist / 15));
            r.dist = 0;
            r.last = null;
            if (amount < 2) return;
            if (act((s, now) => wash(s, amount, now))) {
              sfx.squeak();
              flashEmotion('happy');
            }
          }}
        >
          <svg viewBox="0 0 40 40" class="food-icon">
            <rect x="4" y="10" width="32" height="20" rx="10" fill="#ffafcc" />
            <ellipse cx="14" cy="16" rx="6" ry="3" fill="#fff" opacity="0.7" />
            <circle cx="32" cy="8" r="4" fill="#bde0fe" />
            <circle cx="26" cy="5" r="2.5" fill="#bde0fe" />
          </svg>
        </Draggable>
      </div>
    </div>
  );
}

export function BedroomTray() {
  const p = pet.value!;
  return (
    <div class="tray">
      <button
        class={`btn ${p.sleeping ? '' : 'btn--dark'}`}
        onClick={() => {
          haptic.tap();
          act((s, now) => setSleeping(s, !s.sleeping, now));
        }}
      >
        {p.sleeping ? `💡 ${t().bedroom.lightOn}` : `🌙 ${t().bedroom.lightOff}`}
      </button>
    </div>
  );
}

export function PlayroomTray() {
  return (
    <div class="tray">
      <div class="tray__items">
        <button
          class="btn"
          onClick={() => {
            if (act((s, now) => play(s, now))) {
              haptic.tap();
              sfx.squeak();
              flashEmotion('happy');
              jumping.value = true;
              setTimeout(() => (jumping.value = false), 700);
            }
          }}
        >
          ⚽ {t().playroom.play}
        </button>
        <button
          class="btn btn--accent"
          onClick={() => {
            const p = pet.value!;
            if (p.sleeping) return showToast(t().errors.sleeping, 'error');
            if (p.stats.energy < MIN_ENERGY_TO_PLAY) return showToast(t().errors.tired, 'error');
            haptic.tap();
            overlay.value = { kind: 'game' };
          }}
        >
          🫧 {t().playroom.game} <small>{t().playroom.gameHint}</small>
        </button>
      </div>
    </div>
  );
}
