export const STAT_KEYS = ['satiety', 'hygiene', 'energy', 'mood'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

/** Питомец не «умирает»: ниже этого значения показатели не падают. */
export const STAT_MIN = 5;
export const STAT_MAX = 100;

/** Изменение в час, пока питомец бодрствует (отрицательное — падение). */
const AWAKE_RATE: Stats = { satiety: -6, hygiene: -4, energy: -5, mood: -3 };
/** Во сне энергия восстанавливается, остальное падает медленнее. */
const SLEEP_RATE: Stats = { satiety: -3, hygiene: -2, energy: 20, mood: -1 };
/** Доп. падение настроения в час, если какая-то потребность ниже порога. */
const NEGLECT_MOOD_RATE = -4;
const NEGLECT_THRESHOLD = 30;

const STEP_MS = 5 * 60 * 1000;
/** Дольше этого отсутствия ничего не меняется: всё уже на минимуме. */
const MAX_ELAPSED_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const clamp = (v: number) => Math.min(STAT_MAX, Math.max(STAT_MIN, v));
export const clampStat = (v: number) => Math.round(clamp(v) * 100) / 100;

export function fullStats(): Stats {
  return { satiety: 80, hygiene: 80, energy: 80, mood: 80 };
}

/**
 * Пересчитывает показатели за прошедшее время.
 * Идёт шагами по 5 минут, чтобы штраф за запущенность включался вовремя.
 */
export function applyElapsed(stats: Stats, elapsedMs: number, sleeping: boolean): Stats {
  let left = Math.min(Math.max(0, elapsedMs), MAX_ELAPSED_MS);
  const rate = sleeping ? SLEEP_RATE : AWAKE_RATE;
  const s = { ...stats };
  while (left > 0) {
    const dt = Math.min(STEP_MS, left) / HOUR_MS;
    const neglected =
      s.satiety < NEGLECT_THRESHOLD || s.hygiene < NEGLECT_THRESHOLD || s.energy < NEGLECT_THRESHOLD;
    for (const k of STAT_KEYS) {
      let delta = rate[k] * dt;
      if (k === 'mood' && neglected) delta += NEGLECT_MOOD_RATE * dt;
      s[k] = clamp(s[k] + delta);
    }
    left -= STEP_MS;
  }
  for (const k of STAT_KEYS) s[k] = clampStat(s[k]);
  return s;
}

export function addStats(stats: Stats, delta: Partial<Stats>): Stats {
  const s = { ...stats };
  for (const k of STAT_KEYS) s[k] = clampStat(s[k] + (delta[k] ?? 0));
  return s;
}

export type Emotion = 'neutral' | 'happy' | 'sad' | 'sleep';

export function emotionOf(stats: Stats, sleeping: boolean): Emotion {
  if (sleeping) return 'sleep';
  const lowest = Math.min(stats.satiety, stats.hygiene, stats.energy, stats.mood);
  if (lowest < 25) return 'sad';
  if (stats.mood >= 70 && lowest >= 50) return 'happy';
  return 'neutral';
}
