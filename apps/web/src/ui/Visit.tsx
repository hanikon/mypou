import { useEffect, useRef, useState } from 'preact/hooks';
import { emotionOf, ITEMS, itemsBySlot, sanitize, tick, type Item, type PetState } from '@kaplya/shared';
import { api, ApiError } from '../api';
import { lang, t } from '../i18n';
import { MOUTH, Pet, svgToClient } from '../pet/Pet';
import { Shapes } from '../pet/Shapes';
import { Draggable } from '../rooms/Draggable';
import { RoomBackground } from '../rooms/RoomBackground';
import { sfx } from '../sfx';
import { fail, overlay, pet, showToast } from '../state/store';
import { haptic } from '../telegram';
import { MainAction, useBackButton } from './telegramButtons';

/** В гостях у друга: его питомец, его холодильник и подарки за свои монеты. */
export function Visit({ id }: { id: number }) {
  const [friend, setFriend] = useState<{ name: string; pet: PetState } | null>(null);
  const [eating, setEating] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [gifting, setGifting] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);

  const back = () => {
    if (gifting) {
      setGifting(false);
      setSelected(null);
    } else overlay.value = { kind: 'friends' };
  };
  const ownBack = useBackButton(back);

  useEffect(() => {
    api
      .visit(id)
      .then((r) => setFriend({ name: r.friend.name, pet: sanitize(r.friend.pet, Date.now()) }))
      .catch((e) => {
        fail(e instanceof ApiError ? e.code : 'server');
        overlay.value = { kind: 'friends' };
      });
  }, [id]);

  const distToMouth = (x: number, y: number) => {
    if (!svg.current) return Infinity;
    const m = svgToClient(svg.current, MOUTH.x, MOUTH.y);
    return Math.hypot(x - m.x, y - m.y);
  };

  const feedFriend = async (item: string) => {
    try {
      const r = await api.feedFriend(id, item);
      setFriend((f) => f && { ...f, pet: sanitize(r.pet, Date.now()) });
      sfx.chomp();
      haptic.success();
      setEating(true);
      setTimeout(() => setEating(false), 1400);
      showToast(t().visit.fed);
    } catch (e) {
      fail(e instanceof ApiError ? e.code : 'server');
    }
  };

  const sendGift = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.gift(id, selected.id);
      // Монеты списаны на сервере — обновляем своего питомца.
      pet.value = tick(sanitize(r.pet, Date.now()), Date.now());
      sfx.coin();
      haptic.success();
      showToast(t().visit.gifted);
      const v = await api.visit(id);
      setFriend({ name: v.friend.name, pet: sanitize(v.friend.pet, Date.now()) });
      setSelected(null);
      setGifting(false);
    } catch (e) {
      fail(e instanceof ApiError ? e.code : 'server');
    } finally {
      setBusy(false);
    }
  };

  if (!friend) {
    return (
      <div class="overlay">
        <div class="center">
          <div class="spinner" />
        </div>
      </div>
    );
  }

  const fp = friend.pet;
  const foods = itemsBySlot('food').filter((f) => (fp.food[f.id] ?? 0) > 0);
  const emotion = eating ? 'eating' : emotionOf(fp.stats, fp.sleeping);
  const myCoins = pet.value?.coins ?? 0;

  if (gifting) {
    const giftable = ITEMS.filter((i) => i.price > 0);
    return (
      <div class="overlay shop">
        <header class="overlay__head">
          {ownBack && (
            <button class="icon-btn" aria-label={t().close} onClick={back}>
              ←
            </button>
          )}
          <h2>{t().visit.giftTitle}</h2>
          <span class="coins">🪙 {myCoins}</span>
        </header>
        <p class="shop__hint">{t().visit.limit}</p>
        <div class="shop__grid">
          {giftable.map((item) => {
            const owned = item.slot !== 'food' && fp.owned.includes(item.id);
            return (
              <button
                key={item.id}
                class={`card ${selected?.id === item.id ? 'is-selected' : ''}`}
                disabled={owned}
                onClick={() => {
                  haptic.select();
                  setSelected(item);
                }}
              >
                <GiftIcon item={item} />
                <span class="card__name">{item.name[lang.value]}</span>
                <span class="card__price">{owned ? t().visit.owned : `${item.price} 🪙`}</span>
              </button>
            );
          })}
        </div>
        {selected && (
          <MainAction text={t().visit.giftBtn(selected.price)} disabled={busy || myCoins < selected.price} onClick={sendGift} />
        )}
      </div>
    );
  }

  return (
    <div class="overlay visit">
      <header class="overlay__head">
        {ownBack && (
          <button class="icon-btn" aria-label={t().close} onClick={back}>
            ←
          </button>
        )}
        <h2>{t().visit.title(friend.name)}</h2>
        <button class="btn btn--small" onClick={() => setGifting(true)}>
          {t().visit.gift}
        </button>
      </header>
      <main class="stage">
        <RoomBackground room="kitchen" wallpaper={fp.wear.background} />
        <div class="stage__pet">
          <Pet state={fp} emotion={emotion} mouthOpen={mouthOpen} svgRef={svg} />
        </div>
      </main>
      <div class="tray">
        <span class="tray__hint">{foods.length ? t().visit.hint : t().visit.noFood}</span>
        <div class="tray__items">
          {foods.map((f) => (
            <Draggable
              key={f.id}
              label={f.name[lang.value]}
              onMove={(x, y) => setMouthOpen(distToMouth(x, y) < 110)}
              onDrop={(x, y) => {
                setMouthOpen(false);
                if (distToMouth(x, y) < 70) void feedFriend(f.id);
              }}
            >
              <svg viewBox="0 0 40 40" class="food-icon">
                <Shapes shapes={f.svg} />
              </svg>
              <span class="badge">{fp.food[f.id]}</span>
            </Draggable>
          ))}
        </div>
      </div>
    </div>
  );
}

function GiftIcon({ item }: { item: Item }) {
  if (item.slot === 'color' || item.slot === 'background') {
    return (
      <svg viewBox="0 0 40 40" class="card__icon">
        <circle cx="20" cy="20" r="16" fill={item.color ?? '#b8c0ff'} />
      </svg>
    );
  }
  const vb =
    item.slot === 'food' ? '0 0 40 40' : item.slot === 'hat' ? '50 0 100 70' : item.slot === 'glasses' ? '50 90 100 60' : '50 150 100 50';
  return (
    <svg viewBox={vb} class="card__icon">
      <Shapes shapes={item.svg} />
    </svg>
  );
}
