import {
  applyAction, cappedCoins, checkMiniGame, coinsForScore, finishMiniGame, MIN_ENERGY_TO_PLAY, parseAction,
  verifyInitData, type TgUser,
} from '@kaplya/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, getPet, rateLimit, updatePet, upsertUser } from './db';
import type { Env } from './env';
import { HttpError, json, readJson } from './http';
import { enqueue, flush } from './notify';
import { createGame, getGame, listGames, makeMove, resign } from './games';
import { acceptInvite, feedFriend, giveGift, inviteCode, inviteLink, listFriends, visit } from './social';

/** initData живёт сутки: Mini App может долго висеть открытой. */
const INIT_DATA_MAX_AGE = 24 * 60 * 60;

async function auth(req: Request, env: Env) {
  const h = req.headers.get('Authorization') ?? '';
  if (!h.startsWith('tma ')) throw new HttpError(401, 'unauthorized');
  const r = await verifyInitData(h.slice(4), env.BOT_TOKEN, INIT_DATA_MAX_AGE);
  if (!r.ok) throw new HttpError(401, 'unauthorized');
  return r;
}

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

const SETTINGS = 'lang, notify, notify_hunger, notify_social, notify_game, can_message';

async function getSettings(sb: SupabaseClient, me: number) {
  const { data, error } = await sb.from('users').select(SETTINGS).eq('id', me).single();
  if (error) throw new HttpError(500, 'db_error');
  return data;
}

/** Отправить новые уведомления сразу, не задерживая ответ. Не вышло — досылает cron. */
function sendSoon(ctx: ExecutionContext, env: Env, sb: SupabaseClient, ids: number[] | undefined) {
  if (ids?.length) ctx.waitUntil(flush(env, sb, ids).catch((e) => console.error(`notify: ${(e as Error).message}`)));
}

export async function handleApi(req: Request, env: Env, path: string, ctx: ExecutionContext): Promise<Response> {
  const session = await auth(req, env);
  const user: TgUser = session.user;
  const sb = db(env);
  // Партия опрашивается раз в 2 с, поэтому лимит с запасом.
  await rateLimit(sb, user.id, 'api', 120, 60);

  if (req.method === 'GET' && path === '/api/state') {
    await upsertUser(sb, user);
    const { state } = await getPet(sb, user.id, Date.now());
    const invite = await acceptInvite(sb, user, session.startParam);
    sendSoon(ctx, env, sb, invite?.notifyIds);
    return json({
      pet: state,
      settings: await getSettings(sb, user.id),
      invite: invite && { status: invite.status, name: invite.name },
    });
  }

  if (req.method === 'POST' && path === '/api/action') {
    const action = parseAction(await readJson(req));
    if (!action) throw new HttpError(400, 'bad_request');
    const { state } = await updatePet(sb, user.id, (s, _row, now) => applyAction(s, action, now));
    return json({ pet: state });
  }

  if (req.method === 'POST' && path === '/api/minigame/start') {
    const { state } = await updatePet(sb, user.id, (s, _row, now) => {
      if (s.sleeping) return { ok: false, error: 'sleeping' };
      if (s.stats.energy < MIN_ENERGY_TO_PLAY) return { ok: false, error: 'tired' };
      return { ok: true, state: s, meta: { minigame_started_at: now } };
    });
    return json({ pet: state });
  }

  if (req.method === 'POST' && path === '/api/minigame/finish') {
    const body = (await readJson(req)) as { score?: unknown };
    const { state, extra } = await updatePet<number>(sb, user.id, (s, row, now) => {
      const check = checkMiniGame(row.minigame_started_at, now, body.score);
      if (!check.ok) return { ok: false, error: check.error };
      const day = today(now);
      const earned = row.coins_day === day ? row.coins_today : 0;
      const coins = cappedCoins(coinsForScore(check.score), earned);
      const r = finishMiniGame(s, check.score, now, coins);
      if (!r.ok) return r;
      return {
        ok: true,
        state: r.state,
        meta: { minigame_started_at: null, coins_day: day, coins_today: earned + coins },
        extra: coins,
      };
    });
    return json({ pet: state, coins: extra ?? 0 });
  }

  /* ---------- настройки и уведомления ---------- */

  if (path === '/api/settings') {
    if (req.method === 'GET') return json({ settings: await getSettings(sb, user.id) });
    if (req.method === 'POST') {
      const b = (await readJson(req)) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of ['notify', 'notify_hunger', 'notify_social', 'notify_game'] as const) {
        if (typeof b[k] === 'boolean') patch[k] = b[k];
      }
      if (b.lang === 'ru' || b.lang === 'en') patch.lang = b.lang;
      // Пользователь разрешил в Telegram писать ему (requestWriteAccess). Худшее при обмане — 403 и сброс флага.
      if (b.writeAccess === true) patch.can_message = true;
      if (Object.keys(patch).length) {
        const { error } = await sb.from('users').update(patch).eq('id', user.id);
        if (error) throw new HttpError(500, 'db_error');
      }
      return json({ settings: await getSettings(sb, user.id) });
    }
  }

  if (req.method === 'POST' && path === '/api/notify/test') {
    await rateLimit(sb, user.id, 'notify_test', 3, 60);
    const ids = await enqueue(sb, [{ userId: user.id, kind: 'test', dedupe: `test:${user.id}:${Date.now()}` }]);
    // Тест отправляем синхронно, чтобы сразу показать результат.
    const [r] = await flush(env, sb, ids);
    return json({ result: r?.status ?? 'pending', error: r?.error, settings: await getSettings(sb, user.id) });
  }

  /* ---------- друзья ---------- */

  if (req.method === 'GET' && path === '/api/friends') {
    const code = await inviteCode(sb, user.id);
    return json({ invite: inviteLink(env, code), code, friends: await listFriends(sb, user.id) });
  }

  const m = /^\/api\/friends\/(\d{1,15})(?:\/(feed|gift))?$/.exec(path);
  if (m) {
    const friend = Number(m[1]);
    if (req.method === 'GET' && !m[2]) {
      const r = await visit(sb, user, friend);
      sendSoon(ctx, env, sb, r.notifyIds);
      return json({ friend: r.friend });
    }
    if (req.method === 'POST' && m[2] === 'feed') {
      const { item } = (await readJson(req)) as { item?: unknown };
      if (typeof item !== 'string') throw new HttpError(400, 'bad_request');
      const r = await feedFriend(sb, user, friend, item);
      sendSoon(ctx, env, sb, r.notifyIds);
      return json({ pet: r.pet });
    }
    if (req.method === 'POST' && m[2] === 'gift') {
      const { item } = (await readJson(req)) as { item?: unknown };
      if (typeof item !== 'string') throw new HttpError(400, 'bad_request');
      const r = await giveGift(sb, user, friend, item);
      // Уведомление уже в очереди (в той же транзакции) — отправляем всё готовое.
      ctx.waitUntil(flush(env, sb, undefined, 10).catch(() => undefined));
      return json({ pet: r.pet });
    }
  }

  /* ---------- крестики-нолики ---------- */

  if (path === '/api/games') {
    if (req.method === 'GET') return json(await listGames(sb, user.id));
    if (req.method === 'POST') {
      const { friend } = (await readJson(req)) as { friend?: unknown };
      return json({ game: await createGame(sb, user.id, Number(friend)) });
    }
  }

  const g = /^\/api\/games\/([0-9a-f-]{36})(?:\/(move|resign))?$/i.exec(path);
  if (g) {
    const id = g[1]!;
    if (req.method === 'GET' && !g[2]) return json({ game: await getGame(sb, user.id, id) });
    if (req.method === 'POST' && g[2] === 'move') {
      const b = (await readJson(req)) as { cell?: unknown; moveNo?: unknown };
      const r = await makeMove(sb, user, id, b.cell, b.moveNo);
      sendSoon(ctx, env, sb, r.notifyIds);
      return json({ game: r.game, pet: r.pet });
    }
    if (req.method === 'POST' && g[2] === 'resign') {
      const r = await resign(sb, user, id);
      sendSoon(ctx, env, sb, r.notifyIds);
      return json({ game: r.game });
    }
  }

  throw new HttpError(404, 'not_found');
}
