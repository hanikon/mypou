import { computed, signal } from '@preact/signals';
import { emotionOf, sanitize, tick, type PetState, type Result } from '@kaplya/shared';
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
    const raw = await loadJson(SAVE_KEY);
    const now = Date.now();
    pet.value = tick(sanitize(raw, now), now);
    loadState.value = 'ready';
    if (raw === null) scheduleSave();
  } catch {
    // Не создаём нового питомца: иначе можно затереть настоящее сохранение.
    loadState.value = 'error';
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

export function scheduleSave(delay = 1200) {
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

let toastId = 0;
export function showToast(text: string, kind: 'ok' | 'error' = 'ok') {
  const id = ++toastId;
  toast.value = { text, kind, id };
  setTimeout(() => {
    if (toast.value?.id === id) toast.value = null;
  }, 2500);
}

/** Единая точка изменения состояния: применяет чистое действие из shared и сохраняет. */
export function act(fn: (s: PetState, now: number) => Result): boolean {
  const p = pet.value;
  if (!p) return false;
  const r = fn(p, Date.now());
  if (!r.ok) {
    haptic.error();
    sfx.error();
    showToast(t().errors[r.error], 'error');
    return false;
  }
  pet.value = r.state;
  scheduleSave();
  return true;
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
