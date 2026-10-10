import {
  applyAction, cappedCoins, checkMiniGame, coinsForScore, finishMiniGame, MIN_ENERGY_TO_PLAY, parseAction,
  verifyInitData, type TgUser,
} from '@kaplya/shared';
import { db, getPet, rateLimit, updatePet, upsertUser } from './db';
import type { Env } from './env';
import { HttpError, json, readJson } from './http';

/** initData живёт сутки: Mini App может долго висеть открытой. */
const INIT_DATA_MAX_AGE = 24 * 60 * 60;

async function auth(req: Request, env: Env): Promise<TgUser> {
  const h = req.headers.get('Authorization') ?? '';
  if (!h.startsWith('tma ')) throw new HttpError(401, 'unauthorized');
  const r = await verifyInitData(h.slice(4), env.BOT_TOKEN, INIT_DATA_MAX_AGE);
  if (!r.ok) throw new HttpError(401, 'unauthorized');
  return r.user;
}

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

export async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  const user = await auth(req, env);
  const sb = db(env);
  await rateLimit(sb, user.id, 'api', 60, 60);

  if (req.method === 'GET' && path === '/api/state') {
    await upsertUser(sb, user);
    const { state } = await getPet(sb, user.id, Date.now());
    return json({ pet: state });
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

  throw new HttpError(404, 'not_found');
}
