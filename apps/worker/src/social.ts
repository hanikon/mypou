import type { SupabaseClient } from '@supabase/supabase-js';
import {
  emotionOf, feed, getItem, GIFT_DAILY_LIMIT, MAX_FRIENDS, parseInvite, visitKey, VISIT_FEEDS_PER_HOUR,
} from '@kaplya/shared';
import { getPet, rateLimit, updatePet } from './db';
import type { Env } from './env';
import { HttpError } from './http';
import { enqueue } from './notify';

const pair = (a: number, b: number) => (a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a });

function dbFail(what: string, error: { message: string } | null): never {
  console.error(`social: ${what}: ${error?.message ?? 'unknown'}`);
  throw new HttpError(500, 'db_error');
}

export async function friendIds(sb: SupabaseClient, me: number): Promise<number[]> {
  const { data, error } = await sb.from('friendships').select('user_a, user_b').or(`user_a.eq.${me},user_b.eq.${me}`);
  if (error) dbFail('friends', error);
  return (data ?? []).map((r: { user_a: number; user_b: number }) => (r.user_a === me ? r.user_b : r.user_a));
}

export async function areFriends(sb: SupabaseClient, a: number, b: number) {
  const { data, error } = await sb.from('friendships').select('user_a').match(pair(a, b)).maybeSingle();
  if (error) dbFail('are friends', error);
  return !!data;
}

async function userName(sb: SupabaseClient, id: number): Promise<string> {
  const { data } = await sb.from('users').select('first_name').eq('id', id).maybeSingle();
  return (data as { first_name?: string } | null)?.first_name || '?';
}

/** Код приглашения пользователя (создаётся при первом запросе). */
export async function inviteCode(sb: SupabaseClient, me: number): Promise<string> {
  const { data, error } = await sb.from('users').select('invite_code').eq('id', me).single();
  if (error) dbFail('invite code', error);
  const existing = (data as { invite_code: string | null }).invite_code;
  if (existing) return existing;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  const { error: upErr } = await sb.from('users').update({ invite_code: code }).eq('id', me).is('invite_code', null);
  if (upErr) dbFail('set invite code', upErr);
  // Если параллельный запрос успел первым — берём его код.
  const again = await sb.from('users').select('invite_code').eq('id', me).single();
  return (again.data as { invite_code: string }).invite_code;
}

export function inviteLink(env: Env, code: string): string | null {
  if (!env.BOT_USERNAME || !env.MINIAPP_SHORT_NAME) return null;
  return `https://t.me/${env.BOT_USERNAME}/${env.MINIAPP_SHORT_NAME}?startapp=invite_${code}`;
}

export type InviteStatus = 'added' | 'already' | 'self' | 'invalid' | 'full';

/** Принимает приглашение: me становится другом владельца кода. Повторный вызов безопасен. */
export async function acceptInvite(
  sb: SupabaseClient,
  me: { id: number; first_name: string },
  startParam: string | undefined,
): Promise<{ status: InviteStatus; name?: string; notifyIds?: number[] } | null> {
  const code = parseInvite(startParam);
  if (!code) return null;
  const { data, error } = await sb.from('users').select('id, first_name').eq('invite_code', code).maybeSingle();
  if (error) dbFail('find invite', error);
  const owner = data as { id: number; first_name: string } | null;
  if (!owner) return { status: 'invalid' };
  if (owner.id === me.id) return { status: 'self' };
  if (await areFriends(sb, me.id, owner.id)) return { status: 'already', name: owner.first_name };
  const [mine, theirs] = await Promise.all([friendIds(sb, me.id), friendIds(sb, owner.id)]);
  if (mine.length >= MAX_FRIENDS || theirs.length >= MAX_FRIENDS) return { status: 'full' };

  const { error: insErr } = await sb.from('friendships').upsert(pair(me.id, owner.id), { ignoreDuplicates: true });
  if (insErr) dbFail('add friend', insErr);
  const notifyIds = await enqueue(sb, [
    { userId: owner.id, kind: 'friend', payload: { name: me.first_name }, dedupe: `friend:${owner.id}:${me.id}` },
  ]);
  return { status: 'added', name: owner.first_name, notifyIds };
}

export async function listFriends(sb: SupabaseClient, me: number) {
  const ids = await friendIds(sb, me);
  if (!ids.length) return [];
  const [{ data: users, error: e1 }, { data: pets, error: e2 }] = await Promise.all([
    sb.from('users').select('id, first_name').in('id', ids),
    sb.from('pets').select('user_id, state, ts_ms').in('user_id', ids),
  ]);
  if (e1) dbFail('friend names', e1);
  if (e2) dbFail('friend pets', e2);
  return ((users ?? []) as { id: number; first_name: string }[]).map((u) => {
    const pet = (pets ?? []).find((p: { user_id: number }) => p.user_id === u.id) as
      | { state: { stats?: never; sleeping?: boolean } }
      | undefined;
    let emotion: string | null = null;
    if (pet?.state?.stats) emotion = emotionOf(pet.state.stats, !!pet.state.sleeping);
    return { id: u.id, name: u.first_name, emotion };
  });
}

async function requireFriend(sb: SupabaseClient, me: number, friend: number) {
  if (!Number.isSafeInteger(friend) || friend === me || !(await areFriends(sb, me, friend))) {
    throw new HttpError(403, 'not_friends');
  }
}

/** Визит: показываем питомца друга и (не чаще раза в 3 ч) сообщаем ему. */
export async function visit(sb: SupabaseClient, me: { id: number; first_name: string }, friend: number) {
  await requireFriend(sb, me.id, friend);
  const now = Date.now();
  const [{ state }, name] = await Promise.all([getPet(sb, friend, now), userName(sb, friend)]);
  const notifyIds = await enqueue(sb, [
    { userId: friend, kind: 'visit', payload: { name: me.first_name }, dedupe: visitKey(friend, me.id, now) },
  ]);
  return { friend: { id: friend, name, pet: state }, notifyIds };
}

/** Гость кормит питомца друга едой из его холодильника. */
export async function feedFriend(sb: SupabaseClient, me: { id: number; first_name: string }, friend: number, item: string) {
  await requireFriend(sb, me.id, friend);
  await rateLimit(sb, me.id, `feed:${friend}`, VISIT_FEEDS_PER_HOUR, 3600);
  const { state } = await updatePet(sb, friend, (s, _row, now) => feed(s, item, now));
  const now = Date.now();
  const notifyIds = await enqueue(sb, [
    { userId: friend, kind: 'feed', payload: { name: me.first_name, item }, dedupe: `feed:${friend}:${me.id}:${Math.floor(now / 3_600_000)}` },
  ]);
  return { pet: state, notifyIds };
}

/** Подарок за свои монеты. Всё атомарно в give_gift (включая уведомление в очередь). */
export async function giveGift(sb: SupabaseClient, me: { id: number; first_name: string }, friend: number, itemId: string) {
  await requireFriend(sb, me.id, friend);
  const item = getItem(itemId);
  if (!item || item.price <= 0) throw new HttpError(400, 'unknown_item');
  const { data, error } = await sb.rpc('give_gift', {
    p_from: me.id,
    p_to: friend,
    p_item: item.id,
    p_price: item.price,
    p_stack: item.slot === 'food',
    p_daily: GIFT_DAILY_LIMIT,
    p_payload: { name: me.first_name, item: item.id },
  });
  if (error) dbFail('gift', error);
  if (data !== 'ok') throw new HttpError(409, String(data));
  const { state } = await getPet(sb, me.id, Date.now());
  return { pet: state };
}
