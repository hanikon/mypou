import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getItem, newPet, sanitize, tick, type PetState, type TgUser } from '@kaplya/shared';
import type { Env } from './env';
import { HttpError } from './http';

let cached: { url: string; client: SupabaseClient } | undefined;

/** Клиент с service_role. Живёт только на сервере. */
export function db(env: Env): SupabaseClient {
  if (cached?.url !== env.SUPABASE_URL) {
    cached = {
      url: env.SUPABASE_URL,
      client: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  return cached.client;
}

export interface PetRow {
  user_id: number;
  state: { stats?: unknown; sleeping?: unknown; wear?: unknown };
  coins: number;
  ts_ms: number;
  version: number;
  minigame_started_at: number | null;
  coins_day: string | null;
  coins_today: number;
  inventory: { item_id: string; qty: number }[];
}

/** Служебные поля строки, которые не входят в PetState. */
export interface PetMeta {
  minigame_started_at: number | null;
  coins_day: string | null;
  coins_today: number;
}

function fail(what: string, error: { message: string } | null): never {
  // В лог — только текст ошибки БД, без ключей и данных запроса.
  console.error(`db: ${what}: ${error?.message ?? 'unknown'}`);
  throw new HttpError(500, 'db_error');
}

export async function upsertUser(sb: SupabaseClient, u: TgUser) {
  const { error } = await sb
    .from('users')
    .upsert({ id: u.id, first_name: u.first_name.slice(0, 64), last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) fail('upsert user', error);
}

function rowToState(row: PetRow, now: number): PetState {
  const owned: string[] = [];
  const food: Record<string, number> = {};
  for (const { item_id, qty } of row.inventory ?? []) {
    if (getItem(item_id)?.slot === 'food') food[item_id] = qty;
    else owned.push(item_id);
  }
  return sanitize({ ...row.state, coins: row.coins, ts: row.ts_ms, owned, food }, now);
}

async function loadRow(sb: SupabaseClient, userId: number): Promise<PetRow | null> {
  const { data, error } = await sb
    .from('pets')
    .select('user_id, state, coins, ts_ms, version, minigame_started_at, coins_day, coins_today, inventory(item_id, qty)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('load pet', error);
  return data as PetRow | null;
}

async function save(sb: SupabaseClient, userId: number, version: number, s: PetState, meta: PetMeta) {
  const inventory: Record<string, number> = { ...s.food };
  for (const id of s.owned) inventory[id] = 1;
  const { data, error } = await sb.rpc('save_pet', {
    p_user: userId,
    p_version: version,
    p_state: { stats: s.stats, sleeping: s.sleeping, wear: s.wear },
    p_coins: s.coins,
    p_ts_ms: s.ts,
    p_inventory: inventory,
    p_minigame_started_at: meta.minigame_started_at,
    p_coins_day: meta.coins_day,
    p_coins_today: meta.coins_today,
  });
  if (error) fail('save pet', error);
  return data as number | null;
}

/** Создаёт питомца, если его ещё нет (повторный вызов безопасен). */
async function createPet(sb: SupabaseClient, userId: number, now: number) {
  const s = newPet(now);
  // Строка пользователя нужна для внешнего ключа; имя допишет /api/state.
  const u = await sb.from('users').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (u.error) fail('create user', u.error);
  const { error } = await sb
    .from('pets')
    .upsert(
      { user_id: userId, state: { stats: s.stats, sleeping: s.sleeping, wear: s.wear }, coins: s.coins, ts_ms: s.ts },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
  if (error) fail('create pet', error);
  const row = await loadRow(sb, userId);
  // Только что созданный питомец без инвентаря — выдаём стартовый набор.
  if (row && row.version === 0) await save(sb, userId, 0, s, { minigame_started_at: null, coins_day: null, coins_today: 0 });
}

export async function getPet(sb: SupabaseClient, userId: number, now: number) {
  let row = await loadRow(sb, userId);
  if (!row) {
    await createPet(sb, userId, now);
    row = await loadRow(sb, userId);
  }
  if (!row) throw new HttpError(500, 'no_pet');
  return { state: tick(rowToState(row, now), now), row };
}

export type Change<T> =
  | { ok: true; state: PetState; meta?: Partial<PetMeta>; extra?: T }
  | { ok: false; error: string };

/**
 * Читает питомца, применяет изменение и сохраняет с проверкой версии.
 * Если кто-то успел изменить строку (другая вкладка, подарок), повторяет.
 */
export async function updatePet<T>(
  sb: SupabaseClient,
  userId: number,
  fn: (state: PetState, row: PetRow, now: number) => Change<T>,
): Promise<{ state: PetState; extra?: T }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const { state, row } = await getPet(sb, userId, now);
    const r = fn(state, row, now);
    if (!r.ok) throw new HttpError(409, r.error);
    const meta: PetMeta = {
      minigame_started_at: row.minigame_started_at,
      coins_day: row.coins_day,
      coins_today: row.coins_today,
      ...r.meta,
    };
    const v = await save(sb, userId, row.version, r.state, meta);
    if (v !== null) return { state: r.state, extra: r.extra };
  }
  throw new HttpError(503, 'busy');
}

export async function rateLimit(sb: SupabaseClient, userId: number, bucket: string, limit: number, windowSec: number) {
  const { data, error } = await sb.rpc('rate_hit', {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_sec: windowSec,
  });
  if (error) fail('rate limit', error);
  if (data !== true) throw new HttpError(429, 'rate_limited');
}
