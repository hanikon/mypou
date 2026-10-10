import type { Stats } from './stats';

export const GIFT_DAILY_LIMIT = 3;
export const MAX_FRIENDS = 20;
/** Сколько раз за час гость может покормить чужого питомца. */
export const VISIT_FEEDS_PER_HOUR = 10;

const INVITE_RE = /^invite_([A-Za-z0-9]{8,16})$/;

/** Код из start_param вида invite_<код>, иначе null. */
export function parseInvite(startParam: string | undefined | null): string | null {
  return startParam ? (INVITE_RE.exec(startParam)?.[1] ?? null) : null;
}

/* ---------------- уведомления ---------------- */

export type NotifyKind = 'hungry' | 'visit' | 'feed' | 'gift' | 'friend' | 'turn' | 'test';
export type NotifyPref = 'notify_hunger' | 'notify_social' | 'notify_game';

/** Какая настройка отключает этот тип. test отключить нельзя — он и проверяет доставку. */
export const KIND_PREF: Record<NotifyKind, NotifyPref | null> = {
  hungry: 'notify_hunger',
  visit: 'notify_social',
  feed: 'notify_social',
  gift: 'notify_social',
  friend: 'notify_social',
  turn: 'notify_game',
  test: null,
};

export const MAX_ATTEMPTS = 10;

/** Ошибка Telegram Bot API или сети (code отсутствует). */
export interface SendError {
  code?: number;
  description?: string;
  retryAfter?: number;
}

export type Delivery =
  | { status: 'sent' }
  | { status: 'pending'; nextAt: number; error: string }
  | { status: 'dead'; blocked: boolean; error: string };

/**
 * Что делать после попытки отправки.
 * 429 — ждать сколько сказал Telegram; 403/«chat not found» — бот не может писать (не повторяем);
 * прочие 400 — сообщение битое (не повторяем); сеть/5xx — повтор с нарастающей паузой.
 */
export function deliveryOutcome(err: SendError | null, attempts: number, now: number): Delivery {
  if (!err) return { status: 'sent' };
  const error = `${err.code ?? 'net'}: ${(err.description ?? '').slice(0, 200)}`;
  if (err.code === 429) {
    return { status: 'pending', nextAt: now + Math.max(1, err.retryAfter ?? 5) * 1000, error };
  }
  const d = (err.description ?? '').toLowerCase();
  if (err.code === 403 || (err.code === 400 && /chat not found|user is deactivated|bot can't initiate/.test(d))) {
    return { status: 'dead', blocked: true, error };
  }
  if (err.code === 400 || err.code === 401 || err.code === 404) return { status: 'dead', blocked: false, error };
  if (attempts >= MAX_ATTEMPTS) return { status: 'dead', blocked: false, error };
  // 1, 2, 4, 8 ... минут, не больше часа.
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return { status: 'pending', nextAt: now + minutes * 60_000, error };
}

export const HUNGRY_BELOW = 25;
const HOUR = 3_600_000;

/** Голоден и давно не заходил (если игрок в приложении — напоминать незачем). */
export function isHungryReminderDue(stats: Stats, lastSeenMs: number, now: number): boolean {
  return stats.satiety < HUNGRY_BELOW && now - lastSeenMs > HOUR / 2;
}

/** Не чаще одного напоминания о голоде за 12 часов. */
export const hungryKey = (userId: number, now: number) => `hungry:${userId}:${Math.floor(now / (12 * HOUR))}`;
/** «Друг зашёл в гости» — не чаще раза в 3 часа на пару. */
export const visitKey = (host: number, guest: number, now: number) => `visit:${host}:${guest}:${Math.floor(now / (3 * HOUR))}`;
