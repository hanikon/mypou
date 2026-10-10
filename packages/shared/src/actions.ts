import { WEAR_SLOTS, type WearSlot } from './catalog';
import { buy, equip, feed, play, setSleeping, wash, type PetState, type Result } from './pet';

/** Действия, которые клиент просит выполнить. Сервер применяет их сам по тем же правилам. */
export type ActionReq =
  | { type: 'feed'; item: string }
  | { type: 'wash'; amount: number }
  | { type: 'sleep'; on: boolean }
  | { type: 'play' }
  | { type: 'buy'; item: string }
  | { type: 'equip'; slot: WearSlot; item: string | null };

const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]{1,32}$/.test(v);

/** Строгий разбор запроса: всё лишнее и неверное — null. */
export function parseAction(raw: unknown): ActionReq | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'feed':
    case 'buy':
      return isId(r.item) ? { type: r.type, item: r.item } : null;
    case 'wash':
      return typeof r.amount === 'number' && Number.isFinite(r.amount)
        ? { type: 'wash', amount: Math.max(0, Math.min(60, Math.round(r.amount))) }
        : null;
    case 'sleep':
      return typeof r.on === 'boolean' ? { type: 'sleep', on: r.on } : null;
    case 'play':
      return { type: 'play' };
    case 'equip':
      return WEAR_SLOTS.includes(r.slot as WearSlot) && (r.item === null || isId(r.item))
        ? { type: 'equip', slot: r.slot as WearSlot, item: r.item as string | null }
        : null;
    default:
      return null;
  }
}

export function applyAction(s: PetState, a: ActionReq, now: number): Result {
  switch (a.type) {
    case 'feed':
      return feed(s, a.item, now);
    case 'wash':
      return wash(s, a.amount, now);
    case 'sleep':
      return setSleeping(s, a.on, now);
    case 'play':
      return play(s, now);
    case 'buy':
      return buy(s, a.item);
    case 'equip':
      return equip(s, a.slot, a.item ?? undefined);
  }
}

/** Правила мини-игры «Пузыри», которые проверяет сервер. */
export const MINIGAME = {
  durationSec: 20,
  /** Раньше этого результат не принимаем (небольшой запас на задержки). */
  minSec: 18,
  /** Позже — партия считается брошенной. */
  maxSec: 180,
  /** Пузырь каждые 550 мс × 20 с ≈ 37 шт.; даже все золотые дают < 120. */
  maxScore: 120,
  /** Не больше стольких монет из мини-игр в сутки (UTC). */
  dailyCoins: 150,
} as const;

export type MiniGameCheck = { ok: true; score: number } | { ok: false; error: 'no_game' | 'too_fast' | 'too_late' };

export function checkMiniGame(startedAt: number | null, now: number, score: unknown): MiniGameCheck {
  if (startedAt === null) return { ok: false, error: 'no_game' };
  const sec = (now - startedAt) / 1000;
  if (sec < MINIGAME.minSec) return { ok: false, error: 'too_fast' };
  if (sec > MINIGAME.maxSec) return { ok: false, error: 'too_late' };
  const n = typeof score === 'number' && Number.isFinite(score) ? Math.floor(score) : 0;
  return { ok: true, score: Math.max(0, Math.min(MINIGAME.maxScore, n)) };
}

/** Сколько монет реально начислить с учётом дневного лимита. */
export function cappedCoins(wanted: number, earnedToday: number): number {
  return Math.max(0, Math.min(wanted, MINIGAME.dailyCoins - earnedToday));
}
