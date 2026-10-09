import { describe, expect, it } from 'vitest';
import { applyElapsed, emotionOf, STAT_MAX, STAT_MIN } from '../src/stats';

const H = 60 * 60 * 1000;
const s0 = { satiety: 80, hygiene: 80, energy: 80, mood: 80 };

describe('applyElapsed', () => {
  it('ничего не меняет без прошедшего времени и при отрицательном времени', () => {
    expect(applyElapsed(s0, 0, false)).toEqual(s0);
    expect(applyElapsed(s0, -5 * H, false)).toEqual(s0);
  });

  it('падает по часам, пока питомец не спит', () => {
    const s = applyElapsed(s0, 1 * H, false);
    expect(s.satiety).toBeCloseTo(74);
    expect(s.hygiene).toBeCloseTo(76);
    expect(s.energy).toBeCloseTo(75);
    expect(s.mood).toBeCloseTo(77);
  });

  it('во сне восстанавливает энергию до максимума', () => {
    const s = applyElapsed({ ...s0, energy: 20 }, 10 * H, true);
    expect(s.energy).toBe(STAT_MAX);
    expect(s.satiety).toBeCloseTo(50);
  });

  it('никогда не опускается ниже минимума', () => {
    const s = applyElapsed(s0, 365 * 24 * H, false);
    for (const v of Object.values(s)) expect(v).toBe(STAT_MIN);
  });

  it('настроение падает быстрее, если питомец голоден', () => {
    const fed = applyElapsed(s0, 2 * H, false);
    const hungry = applyElapsed({ ...s0, satiety: 10 }, 2 * H, false);
    expect(hungry.mood).toBeLessThan(fed.mood);
  });

  it('результат не зависит от того, считали один раз или по частям', () => {
    const once = applyElapsed(s0, 6 * H, false);
    let parts = s0;
    for (let i = 0; i < 6; i++) parts = applyElapsed(parts, H, false);
    for (const k of Object.keys(once) as (keyof typeof once)[]) {
      expect(parts[k]).toBeCloseTo(once[k], 0);
    }
  });
});

describe('emotionOf', () => {
  it('выбирает эмоцию по показателям', () => {
    expect(emotionOf(s0, true)).toBe('sleep');
    expect(emotionOf({ ...s0, satiety: 10 }, false)).toBe('sad');
    expect(emotionOf(s0, false)).toBe('happy');
    expect(emotionOf({ ...s0, mood: 50 }, false)).toBe('neutral');
  });
});
