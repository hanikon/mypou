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

export const api = {
  state: () => call<PetRes>('GET', '/api/state'),
  action: (a: ActionReq) => call<PetRes>('POST', '/api/action', a),
  miniGameStart: () => call<PetRes>('POST', '/api/minigame/start', {}),
  miniGameFinish: (score: number) => call<PetRes & { coins: number }>('POST', '/api/minigame/finish', { score }),
};
