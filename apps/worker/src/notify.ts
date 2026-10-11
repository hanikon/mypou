import type { SupabaseClient } from '@supabase/supabase-js';
import { Api, GrammyError, InlineKeyboard } from 'grammy';
import { deliveryOutcome, getItem, KIND_PREF, type NotifyKind, type SendError } from '@kaplya/shared';
import { tgClient, type Env } from './env';

type Lang = 'ru' | 'en';
type Payload = { name?: string; item?: string; gameId?: string; result?: 'lost' | 'draw' | 'resigned' };

const TEXT: Record<Lang, Record<NotifyKind, (p: Payload, item: string) => string>> = {
  ru: {
    hungry: () => '🍎 Твой питомец проголодался! Загляни и покорми его.',
    visit: (p) => `👋 У твоего питомца гость: ${p.name ?? 'друг'}.`,
    feed: (p, item) => `😋 ${p.name ?? 'Друг'} угощает твоего питомца: ${item}.`,
    gift: (p, item) => `🎁 Новый подарок: ${item}! Отправитель: ${p.name ?? 'друг'}.`,
    friend: (p) => `🤝 Приглашение принято! ${p.name ?? 'Друг'} теперь в друзьях.`,
    turn: (p) => `🎮 Твой ход в крестиках-ноликах. Соперник: ${p.name ?? 'друг'}.`,
    game_over: (p) =>
      p.result === 'draw'
        ? `🤝 Ничья в крестиках-ноликах. Соперник: ${p.name ?? 'друг'}. Ещё партию?`
        : p.result === 'resigned'
          ? `🏆 Соперник сдался — победа твоя! Соперник: ${p.name ?? 'друг'}.`
          : `😅 Партия проиграна. Победитель: ${p.name ?? 'друг'}. Реванш?`,
    test: () => '✅ Уведомления работают! Так будут приходить новости о питомце.',
  },
  en: {
    hungry: () => '🍎 Your pet is hungry! Come and feed it.',
    visit: (p) => `👋 ${p.name ?? 'A friend'} is visiting your pet.`,
    feed: (p, item) => `😋 ${p.name ?? 'A friend'} fed your pet: ${item}.`,
    gift: (p, item) => `🎁 ${p.name ?? 'A friend'} sent you a gift: ${item}!`,
    friend: (p) => `🤝 ${p.name ?? 'A friend'} accepted your invite. You are friends now!`,
    turn: (p) => `🎮 Your turn in tic-tac-toe against ${p.name ?? 'your friend'}.`,
    game_over: (p) =>
      p.result === 'draw'
        ? `🤝 Draw in tic-tac-toe against ${p.name ?? 'your friend'}. Another round?`
        : p.result === 'resigned'
          ? `🏆 ${p.name ?? 'Your friend'} resigned — you win!`
          : `😅 ${p.name ?? 'Your friend'} won the tic-tac-toe game. Rematch?`,
    test: () => '✅ Notifications work! This is how pet news will arrive.',
  },
};
const OPEN = { ru: '🎮 Открыть игру', en: '🎮 Open the game' };

/** Кнопка в сообщении: прямая ссылка на Mini App (можно с параметром), иначе web_app-кнопка. */
export function appButton(env: Env, lang: Lang, startParam?: string) {
  const kb = new InlineKeyboard();
  if (env.BOT_USERNAME && env.MINIAPP_SHORT_NAME) {
    const q = startParam ? `?startapp=${encodeURIComponent(startParam)}` : '';
    return kb.url(OPEN[lang], `https://t.me/${env.BOT_USERNAME}/${env.MINIAPP_SHORT_NAME}${q}`);
  }
  return kb.webApp(OPEN[lang], env.WEB_ORIGIN);
}

export interface NotifyInput {
  userId: number;
  kind: NotifyKind;
  payload?: Payload;
  /** Одинаковый ключ — одно уведомление. */
  dedupe?: string;
}

/** Ставит уведомления в очередь. Возвращает id новых (дубли пропускаются). */
export async function enqueue(sb: SupabaseClient, items: NotifyInput[]): Promise<number[]> {
  if (!items.length) return [];
  const rows = items.map((n) => ({ user_id: n.userId, kind: n.kind, payload: n.payload ?? {}, dedupe_key: n.dedupe ?? null }));
  const { data, error } = await sb
    .from('notifications')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error) {
    console.error(`notify: enqueue: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r: { id: number }) => r.id);
}

interface Row {
  id: number;
  user_id: number;
  kind: NotifyKind;
  payload: Payload;
  attempts: number;
}

interface UserRow {
  id: number;
  lang: Lang;
  notify: boolean;
  can_message: boolean;
  notify_hunger: boolean;
  notify_social: boolean;
  notify_game: boolean;
}

function toSendError(e: unknown): SendError {
  if (e instanceof GrammyError) {
    return { code: e.error_code, description: e.description, retryAfter: e.parameters.retry_after };
  }
  // Сетевые ошибки: без кода — будет повтор.
  return { description: e instanceof Error ? e.message : 'unknown' };
}

export type FlushResult = { id: number; status: string; error?: string };

/**
 * Отправляет готовые к отправке уведомления (или конкретные ids).
 * Каждый результат записывается в базу: sent / pending (повтор позже) / dead / skipped.
 */
export async function flush(env: Env, sb: SupabaseClient, ids?: number[], limit = 50): Promise<FlushResult[]> {
  const { data, error } = await sb.rpc('claim_notifications', { p_limit: limit, p_ids: ids ?? null });
  if (error) {
    console.error(`notify: claim: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as Row[];
  if (!rows.length) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: users, error: uErr } = await sb
    .from('users')
    .select('id, lang, notify, can_message, notify_hunger, notify_social, notify_game')
    .in('id', userIds);
  if (uErr) console.error(`notify: users: ${uErr.message}`);
  const byId = new Map(((users ?? []) as UserRow[]).map((u) => [u.id, u]));

  const api = new Api(env.BOT_TOKEN, tgClient(env));
  const results: FlushResult[] = [];

  for (const n of rows) {
    const u = byId.get(n.user_id);
    const pref = KIND_PREF[n.kind];
    if (!u || (n.kind !== 'test' && (!u.notify || (pref && !u[pref])))) {
      await sb.from('notifications').update({ status: 'skipped', locked_until: null, last_error: 'disabled' }).eq('id', n.id);
      results.push({ id: n.id, status: 'skipped' });
      continue;
    }
    // Тестовое шлём всегда: оно и проверяет, может ли бот писать.
    if (!u.can_message && n.kind !== 'test') {
      await sb.from('notifications').update({ status: 'skipped', locked_until: null, last_error: 'no_write_access' }).eq('id', n.id);
      results.push({ id: n.id, status: 'skipped', error: 'no_write_access' });
      continue;
    }

    const lang: Lang = u.lang === 'en' ? 'en' : 'ru';
    const item = getItem(n.payload.item)?.name[lang] ?? '';
    const text = TEXT[lang][n.kind]?.(n.payload, item) ?? '';
    const startParam = n.payload.gameId ? `game_${n.payload.gameId}` : undefined;

    let err: SendError | null = null;
    try {
      await api.sendMessage(n.user_id, text, { reply_markup: appButton(env, lang, startParam) });
    } catch (e) {
      err = toSendError(e);
    }
    const now = Date.now();
    const out = deliveryOutcome(err, n.attempts, now);
    if (out.status === 'sent') {
      await sb.from('notifications').update({ status: 'sent', sent_at: new Date(now).toISOString(), locked_until: null, last_error: null }).eq('id', n.id);
      if (!u.can_message) await sb.from('users').update({ can_message: true }).eq('id', u.id);
    } else if (out.status === 'pending') {
      await sb
        .from('notifications')
        .update({ status: 'pending', next_attempt_at: new Date(out.nextAt).toISOString(), locked_until: null, last_error: out.error })
        .eq('id', n.id);
    } else {
      await sb.from('notifications').update({ status: 'dead', locked_until: null, last_error: out.error }).eq('id', n.id);
      if (out.blocked) await sb.from('users').update({ can_message: false }).eq('id', u.id);
    }
    if (err) console.warn(`notify: #${n.id} ${n.kind} -> ${out.status} (${err.code ?? 'net'})`);
    results.push({ id: n.id, status: out.status, error: out.status === 'sent' ? undefined : out.error });
  }
  return results;
}
