import type { ActionReq, PetState } from '@kaplya/shared';
import { inTelegram, tg } from './telegram';

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

/** Сервер — источник правды, когда открыто в Telegram и задан адрес API. Иначе — офлайн-режим. */
export const serverMode = inTelegram && !!API;

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      signal: ctrl.signal,
      headers: {
        // Подписанные Telegram данные; сервер проверяет подпись и срок.
        Authorization: `tma ${tg!.initData}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? 'server', res.status);
  return data;
}

type PetRes = { pet: PetState };

export interface Settings {
  lang: 'ru' | 'en';
  notify: boolean;
  notify_hunger: boolean;
  notify_social: boolean;
  notify_game: boolean;
  can_message: boolean;
}
export type InviteStatus = 'added' | 'already' | 'self' | 'invalid' | 'full';
export interface FriendBrief {
  id: number;
  name: string;
  emotion: string | null;
}

export interface GameView {
  id: string;
  me: 'X' | 'O';
  opponent: { id: number; name: string };
  board: string;
  turn: 'X' | 'O';
  status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  winner: 'X' | 'O' | 'D' | null;
  moveNo: number;
  finishedAt: string | null;
}
export interface GamesList {
  active: GameView[];
  history: GameView[];
  score: Record<string, { name: string; wins: number; losses: number; draws: number }>;
}

export const api = {
  state: () =>
    call<PetRes & { settings: Settings; invite: { status: InviteStatus; name?: string } | null }>('GET', '/api/state'),
  saveSettings: (patch: Partial<Settings> & { writeAccess?: boolean }) =>
    call<{ settings: Settings }>('POST', '/api/settings', patch),
  notifyTest: () => call<{ result: string; error?: string; settings: Settings }>('POST', '/api/notify/test', {}),
  friends: () => call<{ invite: string | null; code: string; friends: FriendBrief[] }>('GET', '/api/friends'),
  visit: (id: number) => call<{ friend: { id: number; name: string; pet: PetState } }>('GET', `/api/friends/${id}`),
  feedFriend: (id: number, item: string) => call<PetRes>('POST', `/api/friends/${id}/feed`, { item }),
  gift: (id: number, item: string) => call<PetRes>('POST', `/api/friends/${id}/gift`, { item }),
  games: () => call<GamesList>('GET', '/api/games'),
  newGame: (friend: number) => call<{ game: GameView }>('POST', '/api/games', { friend }),
  game: (id: string) => call<{ game: GameView }>('GET', `/api/games/${id}`),
  move: (id: string, cell: number, moveNo: number) =>
    call<{ game: GameView; pet?: PetState }>('POST', `/api/games/${id}/move`, { cell, moveNo }),
  resign: (id: string) => call<{ game: GameView }>('POST', `/api/games/${id}/resign`, {}),
  action: (a: ActionReq) => call<PetRes>('POST', '/api/action', a),
  miniGameStart: () => call<PetRes>('POST', '/api/minigame/start', {}),
  miniGameFinish: (score: number) => call<PetRes & { coins: number }>('POST', '/api/minigame/finish', { score }),
};
