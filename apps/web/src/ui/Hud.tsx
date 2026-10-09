import { STAT_KEYS, type StatKey } from '@kaplya/shared';
import { lang, setLang, t } from '../i18n';
import { soundOn, toggleSound } from '../sfx';
import { overlay, pet, room, type Room } from '../state/store';
import { haptic } from '../telegram';

const ICON: Record<StatKey, string> = { satiety: '🍎', hygiene: '🫧', energy: '⚡', mood: '😊' };

export function StatsBar() {
  const p = pet.value!;
  return (
    <header class="hud">
      <div class="hud__stats">
        {STAT_KEYS.map((k) => {
          const v = Math.round(p.stats[k]);
          return (
            <div class="stat" key={k} title={t().stats[k]}>
              <span class="stat__icon" aria-hidden="true">
                {ICON[k]}
              </span>
              <div
                class={`stat__bar ${v < 25 ? 'is-low' : ''}`}
                role="meter"
                aria-label={t().stats[k]}
                aria-valuenow={v}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: `${v}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div class="hud__side">
        <span class="coins">🪙 {p.coins}</span>
        <button class="icon-btn" aria-label={t().sound} onClick={toggleSound}>
          {soundOn.value ? '🔊' : '🔇'}
        </button>
        <button class="icon-btn" onClick={() => setLang(lang.value === 'ru' ? 'en' : 'ru')}>
          {lang.value.toUpperCase()}
        </button>
      </div>
    </header>
  );
}

const ROOMS: { id: Room; icon: string }[] = [
  { id: 'kitchen', icon: '🍽️' },
  { id: 'bathroom', icon: '🛁' },
  { id: 'bedroom', icon: '🛏️' },
  { id: 'playroom', icon: '🧸' },
];

export function Nav() {
  return (
    <nav class="nav">
      {ROOMS.map((r) => (
        <button
          key={r.id}
          class={`nav__btn ${room.value === r.id ? 'is-active' : ''}`}
          onClick={() => {
            haptic.select();
            room.value = r.id;
          }}
        >
          <span aria-hidden="true">{r.icon}</span>
          <small>{t().rooms[r.id]}</small>
        </button>
      ))}
      <button
        class="nav__btn"
        onClick={() => {
          haptic.select();
          overlay.value = { kind: 'shop' };
        }}
      >
        <span aria-hidden="true">🛍️</span>
        <small>{t().shop}</small>
      </button>
    </nav>
  );
}
