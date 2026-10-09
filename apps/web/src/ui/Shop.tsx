import { useState } from 'preact/hooks';
import { buy, equip, getItem, itemsBySlot, type Item, type Slot, type WearSlot } from '@kaplya/shared';
import { lang, t } from '../i18n';
import { Pet } from '../pet/Pet';
import { Shapes } from '../pet/Shapes';
import { sfx } from '../sfx';
import { act, overlay, pet, showToast } from '../state/store';
import { haptic } from '../telegram';
import { MainAction, useBackButton } from './telegramButtons';

const TABS: Slot[] = ['food', 'color', 'hat', 'glasses', 'outfit', 'background'];

export function Shop({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Slot>(TABS.includes(initialTab as Slot) ? (initialTab as Slot) : 'food');
  const [selected, setSelected] = useState<Item | null>(null);
  const close = () => (overlay.value = null);
  const ownBack = useBackButton(close);
  const p = pet.value!;

  // Примерка: выбранная, но не купленная вещь видна на питомце.
  const preview =
    selected && selected.slot !== 'food' ? { ...p.wear, [selected.slot]: selected.id } : p.wear;

  const tapItem = (item: Item) => {
    haptic.select();
    if (item.slot === 'food' || !p.owned.includes(item.id)) {
      setSelected(item);
      return;
    }
    setSelected(null);
    const slot = item.slot as WearSlot;
    const wearing = p.wear[slot] === item.id;
    act((s) => equip(s, slot, wearing && slot !== 'color' ? undefined : item.id));
  };

  const purchase = () => {
    if (!selected) return;
    const item = selected;
    if (!act((s) => buy(s, item.id))) return;
    sfx.coin();
    haptic.success();
    showToast(t().bought);
    if (item.slot !== 'food') {
      act((s) => equip(s, item.slot as WearSlot, item.id));
      setSelected(null);
    }
  };

  return (
    <div class="overlay shop">
      <header class="overlay__head">
        {ownBack && (
          <button class="icon-btn" aria-label={t().close} onClick={close}>
            ✕
          </button>
        )}
        <h2>{t().shop}</h2>
        <span class="coins">🪙 {p.coins}</span>
      </header>
      <div class="shop__preview">
        <Pet state={{ ...p, wear: preview }} emotion="happy" class="pet--small" />
      </div>
      <nav class="tabs" role="tablist">
        {TABS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            class={`tab ${tab === s ? 'is-active' : ''}`}
            onClick={() => {
              haptic.select();
              setTab(s);
              setSelected(null);
            }}
          >
            {t().shopTabs[s]}
          </button>
        ))}
      </nav>
      {tab !== 'food' && <p class="shop__hint">{t().shopUi.tapToWear}</p>}
      <div class="shop__grid">
        {itemsBySlot(tab).map((item) => {
          const owned = item.slot !== 'food' && p.owned.includes(item.id);
          const wearing = item.slot !== 'food' && p.wear[item.slot as WearSlot] === item.id;
          return (
            <button
              key={item.id}
              class={`card ${selected?.id === item.id ? 'is-selected' : ''} ${wearing ? 'is-wearing' : ''}`}
              onClick={() => tapItem(item)}
            >
              <ItemIcon item={item} />
              <span class="card__name">{item.name[lang.value]}</span>
              <span class="card__price">
                {wearing
                  ? t().shopUi.wearing
                  : owned
                    ? t().shopUi.owned
                    : item.slot === 'food' && p.food[item.id]
                      ? `${item.price} 🪙 · ${t().shopUi.have(p.food[item.id]!)}`
                      : `${item.price} 🪙`}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <MainAction
          text={t().shopUi.buy(selected.price)}
          disabled={p.coins < selected.price}
          onClick={purchase}
        />
      )}
    </div>
  );
}

function ItemIcon({ item }: { item: Item }) {
  if (item.slot === 'food') {
    return (
      <svg viewBox="0 0 40 40" class="card__icon">
        <Shapes shapes={item.svg} />
      </svg>
    );
  }
  if (item.slot === 'color') {
    return (
      <svg viewBox="0 0 40 40" class="card__icon">
        <circle cx="20" cy="20" r="16" fill={item.color} />
      </svg>
    );
  }
  if (item.slot === 'background') {
    return (
      <svg viewBox="0 0 40 40" class="card__icon">
        <rect x="2" y="2" width="36" height="36" rx="8" fill="#b8c0ff" />
        {item.pattern === 'dots' && <circle cx="20" cy="20" r="5" fill={item.color} />}
        {item.pattern === 'stripes' && <rect x="14" y="2" width="10" height="36" fill={item.color} opacity="0.6" />}
        {item.pattern === 'stars' && <path d="M20 8 L23 17 L32 17 L25 22 L28 31 L20 26 L12 31 L15 22 L8 17 L17 17 Z" fill={item.color} />}
        {item.pattern === 'waves' && <path d="M4 20 Q12 12 20 20 T36 20" stroke={item.color} stroke-width="3" fill="none" />}
      </svg>
    );
  }
  // Одежда: показываем вещь на силуэте нужной части тела.
  const vb = item.slot === 'hat' ? '50 0 100 70' : item.slot === 'glasses' ? '50 90 100 60' : '50 150 100 50';
  return (
    <svg viewBox={vb} class="card__icon">
      <Shapes shapes={getItem(item.id)?.svg} />
    </svg>
  );
}
