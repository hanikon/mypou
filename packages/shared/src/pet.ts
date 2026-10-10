import { APP_CONFIG } from './config';
import { FREE_ITEMS, getItem, type WearSlot, WEAR_SLOTS } from './catalog';
import { addStats, applyElapsed, clampStat, fullStats, STAT_KEYS, type Stats } from './stats';

export interface PetState {
  v: 1;
  stats: Stats;
  /** Момент, на который посчитаны stats (мс). */
  ts: number;
  sleeping: boolean;
  coins: number;
  /** Купленные вещи (одежда, цвета, фоны). */
  owned: string[];
  /** Еда: id -> количество. */
  food: Record<string, number>;
  wear: Partial<Record<WearSlot, string>>;
}

export type ActionError =
  | 'unknown_item'
  | 'not_enough_coins'
  | 'already_owned'
  | 'not_owned'
  | 'no_food'
  | 'sleeping'
  | 'tired';

export type Result = { ok: true; state: PetState } | { ok: false; error: ActionError };

const ok = (state: PetState): Result => ({ ok: true, state });
const fail = (error: ActionError): Result => ({ ok: false, error });

export function newPet(now: number): PetState {
  return {
    v: 1,
    stats: fullStats(),
    ts: now,
    sleeping: false,
    coins: APP_CONFIG.startCoins,
    owned: [...FREE_ITEMS],
    food: { f_apple: 3, f_berry: 3 },
    wear: { color: 'c_mint', background: 'b_none' },
  };
}

/** Догоняет показатели до текущего момента. */
export function tick(s: PetState, now: number): PetState {
  if (now <= s.ts) return s;
  return { ...s, stats: applyElapsed(s.stats, now - s.ts, s.sleeping), ts: now };
}

export function feed(s: PetState, foodId: string, now: number): Result {
  const item = getItem(foodId);
  if (!item?.food) return fail('unknown_item');
  if ((s.food[foodId] ?? 0) <= 0) return fail('no_food');
  const t = tick(s, now);
  if (t.sleeping) return fail('sleeping');
  const food = { ...t.food, [foodId]: (t.food[foodId] ?? 0) - 1 };
  if (food[foodId] === 0) delete food[foodId];
  return ok({ ...t, food, stats: addStats(t.stats, item.food) });
}

/** amount — сколько «натёрли» мылом (0..100). */
export function wash(s: PetState, amount: number, now: number): Result {
  const t = tick(s, now);
  if (t.sleeping) return fail('sleeping');
  const a = Math.max(0, Math.min(100, amount));
  return ok({ ...t, stats: addStats(t.stats, { hygiene: a, mood: a / 10 }) });
}

export function setSleeping(s: PetState, sleeping: boolean, now: number): Result {
  const t = tick(s, now);
  return ok({ ...t, sleeping });
}

export const PLAY_ENERGY = 8;
export const MINIGAME_ENERGY = 10;
export const MIN_ENERGY_TO_PLAY = 15;

export function play(s: PetState, now: number): Result {
  const t = tick(s, now);
  if (t.sleeping) return fail('sleeping');
  if (t.stats.energy < MIN_ENERGY_TO_PLAY) return fail('tired');
  return ok({ ...t, stats: addStats(t.stats, { mood: 12, energy: -PLAY_ENERGY }) });
}

export const MAX_MINIGAME_COINS = 20;
export const coinsForScore = (score: number) =>
  Math.max(0, Math.min(MAX_MINIGAME_COINS, Math.floor(score / 3)));

/** coinCap — сколько монет ещё можно дать (дневной лимит считает сервер). */
export function finishMiniGame(s: PetState, score: number, now: number, coinCap = Infinity): Result {
  const t = tick(s, now);
  return ok({
    ...t,
    coins: t.coins + Math.min(coinsForScore(score), Math.max(0, coinCap)),
    stats: addStats(t.stats, { mood: 10, energy: -MINIGAME_ENERGY }),
  });
}

export function buy(s: PetState, itemId: string): Result {
  const item = getItem(itemId);
  if (!item) return fail('unknown_item');
  if (item.slot !== 'food' && s.owned.includes(itemId)) return fail('already_owned');
  if (s.coins < item.price) return fail('not_enough_coins');
  const coins = s.coins - item.price;
  if (item.slot === 'food') {
    return ok({ ...s, coins, food: { ...s.food, [itemId]: (s.food[itemId] ?? 0) + 1 } });
  }
  return ok({ ...s, coins, owned: [...s.owned, itemId] });
}

/** id=undefined снимает вещь (кроме цвета — он обязателен). */
export function equip(s: PetState, slot: WearSlot, id: string | undefined): Result {
  if (id === undefined) {
    if (slot === 'color') return fail('unknown_item');
    const wear = { ...s.wear };
    delete wear[slot];
    return ok({ ...s, wear });
  }
  const item = getItem(id);
  if (!item || item.slot !== slot) return fail('unknown_item');
  if (!s.owned.includes(id)) return fail('not_owned');
  return ok({ ...s, wear: { ...s.wear, [slot]: id } });
}

/** Приводит сохранённые данные к корректному виду. Данным из хранилища не доверяем. */
export function sanitize(raw: unknown, now: number): PetState {
  const base = newPet(now);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<PetState>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  const stats = { ...base.stats };
  for (const k of STAT_KEYS) stats[k] = clampStat(num(r.stats?.[k], base.stats[k]));

  const owned = new Set(base.owned);
  if (Array.isArray(r.owned)) {
    for (const id of r.owned) {
      const it = typeof id === 'string' ? getItem(id) : undefined;
      if (it && it.slot !== 'food') owned.add(it.id);
    }
  }

  const food: Record<string, number> = {};
  if (r.food && typeof r.food === 'object') {
    for (const [id, n] of Object.entries(r.food)) {
      const c = Math.floor(num(n, 0));
      if (getItem(id)?.food && c > 0) food[id] = Math.min(c, 999);
    }
  }

  const wear: PetState['wear'] = { color: base.wear.color };
  if (r.wear && typeof r.wear === 'object') {
    for (const slot of WEAR_SLOTS) {
      const id = r.wear[slot];
      if (typeof id === 'string' && owned.has(id) && getItem(id)?.slot === slot) wear[slot] = id;
    }
  }

  const ts = num(r.ts, now);
  return {
    v: 1,
    stats,
    // Метка из будущего (сбитые часы) не должна замораживать питомца.
    ts: Math.min(ts, now),
    sleeping: r.sleeping === true,
    coins: Math.max(0, Math.floor(num(r.coins, base.coins))),
    owned: [...owned],
    food,
    wear,
  };
}
