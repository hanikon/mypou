import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyMove, EMPTY_BOARD, other, TTT_DAILY_REWARDS, TTT_WIN_COINS, type Mark, type Outcome,
} from '@kaplya/shared';
import { getPet } from './db';
import { HttpError } from './http';
import { areFriends } from './social';

interface GameRow {
  id: string;
  player_x: number;
  player_o: number;
  board: string;
  turn: Mark;
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  winner: Outcome | null;
  move_no: number;
  x_seen_at: string | null;
  o_seen_at: string | null;
  updated_at: string;
  finished_at: string | null;
}

const COLS = 'id, player_x, player_o, board, turn, status, winner, move_no, x_seen_at, o_seen_at, updated_at, finished_at';
/** Если соперник смотрел партию последние N секунд — он и так увидит ход, без уведомления. */
const WATCHING_MS = 8_000;

function dbFail(what: string, error: { message: string } | null): never {
  console.error(`games: ${what}: ${error?.message ?? 'unknown'}`);
  throw new HttpError(500, 'db_error');
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const markOf = (g: GameRow, me: number): Mark | null => (g.player_x === me ? 'X' : g.player_o === me ? 'O' : null);
const opponentOf = (g: GameRow, me: number) => (g.player_x === me ? g.player_o : g.player_x);

async function names(sb: SupabaseClient, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('users').select('id, first_name').in('id', [...new Set(ids)]);
  if (error) dbFail('names', error);
  return new Map(((data ?? []) as { id: number; first_name: string }[]).map((u) => [u.id, u.first_name || '?']));
}

export interface GameView {
  id: string;
  me: Mark;
  opponent: { id: number; name: string };
  board: string;
  turn: Mark;
  status: GameRow['status'];
  winner: Outcome | null;
  moveNo: number;
  finishedAt: string | null;
}

function view(g: GameRow, me: number, nameMap: Map<number, string>): GameView {
  const opp = opponentOf(g, me);
  return {
    id: g.id,
    me: markOf(g, me)!,
    opponent: { id: opp, name: nameMap.get(opp) ?? '?' },
    board: g.board,
    turn: g.turn,
    status: g.status,
    winner: g.winner,
    moveNo: g.move_no,
    finishedAt: g.finished_at,
  };
}

async function loadGame(sb: SupabaseClient, id: string, me: number): Promise<GameRow> {
  if (!isUuid(id)) throw new HttpError(404, 'no_game');
  const { data, error } = await sb.from('games').select(COLS).eq('id', id).maybeSingle();
  if (error) dbFail('load', error);
  const g = data as GameRow | null;
  // Чужую партию не показываем и не выдаём, что она существует.
  if (!g || markOf(g, me) === null) throw new HttpError(404, 'no_game');
  return g;
}

/** Активные партии, последние сыгранные и общий счёт с каждым соперником. */
export async function listGames(sb: SupabaseClient, me: number) {
  const { data, error } = await sb
    .from('games')
    .select(COLS)
    .or(`player_x.eq.${me},player_o.eq.${me}`)
    .in('status', ['playing', 'finished'])
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) dbFail('list', error);
  const rows = (data ?? []) as GameRow[];
  const nameMap = await names(sb, rows.map((g) => opponentOf(g, me)));
  const score: Record<number, { name: string; wins: number; losses: number; draws: number }> = {};
  for (const g of rows) {
    if (g.status !== 'finished' || !g.winner) continue;
    const opp = opponentOf(g, me);
    const s = (score[opp] ??= { name: nameMap.get(opp) ?? '?', wins: 0, losses: 0, draws: 0 });
    if (g.winner === 'D') s.draws++;
    else if (g.winner === markOf(g, me)) s.wins++;
    else s.losses++;
  }
  return {
    active: rows.filter((g) => g.status === 'playing').map((g) => view(g, me, nameMap)),
    history: rows.filter((g) => g.status === 'finished').slice(0, 20).map((g) => view(g, me, nameMap)),
    score,
  };
}

/** Новая партия с другом (или уже идущая). Пригласивший играет крестиками и ходит первым. */
export async function createGame(sb: SupabaseClient, me: number, friend: number): Promise<GameView> {
  if (!Number.isSafeInteger(friend) || friend === me || !(await areFriends(sb, me, friend))) {
    throw new HttpError(403, 'not_friends');
  }
  const findActive = async () => {
    const { data, error } = await sb
      .from('games')
      .select(COLS)
      .eq('status', 'playing')
      .or(`and(player_x.eq.${me},player_o.eq.${friend}),and(player_x.eq.${friend},player_o.eq.${me})`)
      .maybeSingle();
    if (error) dbFail('find active', error);
    return data as GameRow | null;
  };
  let g = await findActive();
  if (!g) {
    const { data, error } = await sb
      .from('games')
      .insert({ player_x: me, player_o: friend, board: EMPTY_BOARD, turn: 'X', status: 'playing' })
      .select(COLS)
      .single();
    // 23505 — параллельный запрос уже создал партию: берём её.
    if (error && error.code !== '23505') dbFail('create', error);
    g = (data as GameRow | null) ?? (await findActive());
  }
  if (!g) throw new HttpError(500, 'db_error');
  return view(g, me, await names(sb, [friend]));
}

/** Партия для экрана; заодно отмечаем, что игрок сейчас смотрит на неё. */
export async function getGame(sb: SupabaseClient, me: number, id: string): Promise<GameView> {
  const g = await loadGame(sb, id, me);
  if (g.status === 'playing') {
    const col = markOf(g, me) === 'X' ? 'x_seen_at' : 'o_seen_at';
    await sb.from('games').update({ [col]: new Date().toISOString() }).eq('id', g.id);
  }
  return view(g, me, await names(sb, [opponentOf(g, me)]));
}

interface Commit {
  board: string;
  turn: Mark;
  status: 'playing' | 'finished';
  winner: Outcome | null;
  rewardUser: number | null;
  notify: { kind: 'turn' | 'game_over'; payload: Record<string, unknown>; key: string } | null;
}

async function commit(sb: SupabaseClient, g: GameRow, c: Commit, opp: number) {
  const { data, error } = await sb.rpc('game_commit', {
    p_game: g.id,
    p_expected_move: g.move_no,
    p_board: c.board,
    p_turn: c.turn,
    p_status: c.status,
    p_winner: c.winner,
    p_reward_user: c.rewardUser,
    p_reward_coins: c.rewardUser ? TTT_WIN_COINS : 0,
    p_reward_daily: TTT_DAILY_REWARDS,
    p_notify_user: c.notify ? opp : null,
    p_notify_kind: c.notify?.kind ?? null,
    p_notify_payload: c.notify?.payload ?? null,
    p_notify_key: c.notify?.key ?? null,
  });
  if (error) dbFail('commit', error);
  const res = String(data);
  // Кто-то успел сходить раньше (вторая вкладка, двойное нажатие) — клиент обновит партию.
  if (res === 'conflict') throw new HttpError(409, 'stale');
  const nid = Number(res.split(':')[1]);
  return Number.isFinite(nid) && nid > 0 ? [nid] : [];
}

/** Ход: проверяем всё на сервере — чей ход, клетка, номер хода, итог партии. */
export async function makeMove(
  sb: SupabaseClient,
  me: { id: number; first_name: string },
  id: string,
  cell: unknown,
  moveNo: unknown,
) {
  const g = await loadGame(sb, id, me.id);
  if (g.status !== 'playing') throw new HttpError(409, 'finished');
  if (moveNo !== g.move_no) throw new HttpError(409, 'stale');
  const mark = markOf(g, me.id)!;
  const r = applyMove(g.board, g.turn, mark, cell);
  if (!r.ok) throw new HttpError(409, r.error);

  const opp = opponentOf(g, me.id);
  const finished = r.outcome !== null;
  const oppSeen = mark === 'X' ? g.o_seen_at : g.x_seen_at;
  const watching = !!oppSeen && Date.now() - Date.parse(oppSeen) < WATCHING_MS;
  const notify: Commit['notify'] = finished
    ? { kind: 'game_over', payload: { name: me.first_name, result: r.outcome === 'D' ? 'draw' : 'lost', gameId: g.id }, key: `over:${g.id}` }
    : watching
      ? null
      : { kind: 'turn', payload: { name: me.first_name, gameId: g.id }, key: `turn:${g.id}:${g.move_no + 1}` };

  const notifyIds = await commit(
    sb,
    g,
    {
      board: r.board,
      turn: r.turn,
      status: finished ? 'finished' : 'playing',
      winner: r.outcome,
      rewardUser: r.outcome === mark ? me.id : null,
      notify,
    },
    opp,
  );
  const after = await loadGame(sb, id, me.id);
  const pet = finished ? (await getPet(sb, me.id, Date.now())).state : undefined;
  return { game: view(after, me.id, await names(sb, [opp])), pet, notifyIds };
}

/** Сдаться. Монеты за победу сдачей не даются — чтобы нельзя было «дарить» их друг другу. */
export async function resign(sb: SupabaseClient, me: { id: number; first_name: string }, id: string) {
  const g = await loadGame(sb, id, me.id);
  if (g.status !== 'playing') throw new HttpError(409, 'finished');
  const mark = markOf(g, me.id)!;
  const opp = opponentOf(g, me.id);
  const notifyIds = await commit(
    sb,
    g,
    {
      board: g.board,
      turn: g.turn,
      status: 'finished',
      winner: other(mark),
      rewardUser: null,
      notify: { kind: 'game_over', payload: { name: me.first_name, result: 'resigned', gameId: g.id }, key: `over:${g.id}` },
    },
    opp,
  );
  const after = await loadGame(sb, id, me.id);
  return { game: view(after, me.id, await names(sb, [opp])), notifyIds };
}
