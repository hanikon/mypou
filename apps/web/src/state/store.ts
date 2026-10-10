import { computed, signal } from '@preact/signals';
import {
  applyAction, coinsForScore, emotionOf, finishMiniGame, MIN_ENERGY_TO_PLAY, sanitize, tick,
  type ActionReq, type PetState,
} from '@kaplya/shared';
import { api, ApiError, serverMode } from '../api';
import { t } from '../i18n';
import { haptic } from '../telegram';
import { sfx } from '../sfx';
import { loadJson, saveJson } from './cloud';

export type Room = 'kitchen' | 'bathroom' | 'bedroom' | 'playroom';
export type Overlay = { kind: 'shop'; tab?: string } | { kind: 'game' } | null;

export const pet = signal<PetState | null>(null);
export const loadState = signal<'loading' | 'ready' | 'error'>('loading');
export const room = signal<Room>('kitchen');
export const overlay = signal<Overlay>(null);
export const toast = signal<{ text: string; kind: 'ok' | 'error'; id: number } | null>(null);
/** Кратковременная эмоция поверх рассчитанной (например, «ест»). */
export const transient = signal<'eating' | 'happy' | null>(null);

export const emotion = computed(() => {
  const p = pet.value;
  if (!p) return 'neutral' as const;
  if (p.sleeping) return 'sleep' as const;
  return transient.value ?? emotionOf(p.stats, p.sleeping);
});

const SAVE_KEY = 'pet';

export async function load() {
  loadState.value = 'loading';
  try {
    const now = Date.now();
    if (serverMode) {
      pet.value = tick(sanitize((await api.state()).pet, now), now);
    } else {
      const raw = await loadJson(SAVE_KEY);
      pet.value = tick(sanitize(raw, now), now);
      if (raw === null) scheduleSave();
    }
    loadState.value = 'ready';
  } catch {
    // Не создаём нового питомца: иначе можно затереть настоящее сохранение.
    loadState.value = 'error';
  }
}

/* ---------- офлайн-режим: сохранение в CloudStorage / localStorage ---------- */

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function scheduleSave(delay = 1200) {
  if (serverMode) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, delay);
}

export async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !pet.value) return;
  dirty = false;
  try {
    await saveJson(SAVE_KEY, pet.value);
  } catch {
    showToast(t().errors.saveFailed, 'error');
    scheduleSave(5000);
  }
}

/* ---------- общие помощники ---------- */

let toastId = 0;
export function showToast(text: string, kind: 'ok' | 'error' = 'ok') {
  const id = ++toastId;
  toast.value = { text, kind, id };
  setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, 2500);
}

export function errorText(code: string): string {
  const e = t().errors as Record<string, string>;
  return e[code] ?? e.server!;
}

function fail(code: string) {
  haptic.error();
  sfx.error();
  showToast(errorText(code), 'error');
}

/* ---------- действия ---------- */

/** Запросы к серверу идут по одному, в порядке нажатий. */
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

async function resync() {
  try {
    const now = Date.now();
    pet.value = tick(sanitize((await api.state()).pet, now), now);
  } catch {
    /* следующее действие попробует снова */
  }
}

/**
 * Применяет действие сразу (по тем же правилам, что и сервер), чтобы интерфейс не ждал сети.
 * В серверном режиме ответ сервера заменяет локальный результат; при отказе — откат.
 */
export function act(req: ActionReq): boolean {
  const p = pet.value;
  if (!p) return false;
  const r = applyAction(p, req, Date.now());
  if (!r.ok) {
    fail(r.error);
    return false;
  }
  pet.value = r.state;
  if (!serverMode) {
    scheduleSave();
    return true;
  }
  pending++;
  queue = queue.then(async () => {
    try {
      const res = await api.action(req);
      // Пока в очереди есть ещё действия, не перетираем оптимистичное состояние.
      if (pending === 1) pet.value = tick(sanitize(res.pet, Date.now()), Date.now());
    } catch (e) {
      fail(e instanceof ApiError ? e.code : 'server');
      await resync();
    } finally {
      pending--;
    }
  });
  return true;
}

/** Можно ли сейчас играть (проверка на устройстве, сервер проверит ещё раз). */
export function canPlay(): boolean {
  const p = pet.value;
  if (!p) return false;
  if (p.sleeping) return fail('sleeping'), false;
  if (p.stats.energy < MIN_ENERGY_TO_PLAY) return fail('tired'), false;
  return true;
}

/** Старт мини-игры: на сервере фиксируется время начала. */
export async function startMiniGame(): Promise<boolean> {
  if (!canPlay()) return false;
  if (!serverMode) return true;
  try {
    await queue;
    await api.miniGameStart();
    return true;
  } catch (e) {
    fail(e instanceof ApiError ? e.code : 'server');
    return false;
  }
}

/** Итог мини-игры. Монеты начисляет сервер (с дневным лимитом); возвращает начисленное. */
export async function finishMiniGameAct(score: number): Promise<number | null> {
  const p = pet.value;
  if (!p) return null;
  if (!serverMode) {
    const r = finishMiniGame(p, score, Date.now());
    if (!r.ok) return null;
    pet.value = r.state;
    scheduleSave();
    return coinsForScore(score);
  }
  try {
    await queue;
    const res = await api.miniGameFinish(score);
    pet.value = tick(sanitize(res.pet, Date.now()), Date.now());
    return res.coins;
  } catch (e) {
    fail(e instanceof ApiError ? e.code : 'server');
    return null;
  }
}

let transientTimer: ReturnType<typeof setTimeout> | undefined;
export function flashEmotion(e: 'eating' | 'happy', ms = 1400) {
  transient.value = e;
  clearTimeout(transientTimer);
  transientTimer = setTimeout(() => (transient.value = null), ms);
}

/** Показатели «тикают», пока приложение открыто. Сохранять тик не нужно: он пересчитывается. */
export function startClock() {
  const id = setInterval(() => {
    if (pet.value) pet.value = tick(pet.value, Date.now());
  }, 10_000);
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onHide);
  };
}
