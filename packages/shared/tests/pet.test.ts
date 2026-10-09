import { describe, expect, it } from 'vitest';
import {
  buy, coinsForScore, equip, feed, finishMiniGame, MAX_MINIGAME_COINS, newPet, play, sanitize,
  setSleeping, wash, type Result,
} from '../src/pet';
import { ITEMS } from '../src/catalog';
import { chunkKeys, splitChunks } from '../src/storage';

const NOW = 1_700_000_000_000;
const unwrap = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('каталог', () => {
  it('id уникальны, у еды есть параметры', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const i of ITEMS.filter((x) => x.slot === 'food')) expect(i.food).toBeDefined();
    for (const i of ITEMS.filter((x) => x.slot === 'color')) expect(i.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('действия', () => {
  it('кормление тратит еду и повышает сытость', () => {
    const p = newPet(NOW);
    const s = unwrap(feed({ ...p, stats: { ...p.stats, satiety: 40 } }, 'f_apple', NOW));
    expect(s.stats.satiety).toBe(55);
    expect(s.food.f_apple).toBe(2);
  });

  it('нельзя кормить без еды и спящего питомца', () => {
    const p = newPet(NOW);
    expect(feed(p, 'f_cake', NOW)).toEqual({ ok: false, error: 'no_food' });
    const sleeping = unwrap(setSleeping(p, true, NOW));
    expect(feed(sleeping, 'f_apple', NOW)).toEqual({ ok: false, error: 'sleeping' });
  });

  it('мытьё повышает чистоту', () => {
    const p = newPet(NOW);
    expect(unwrap(wash({ ...p, stats: { ...p.stats, hygiene: 20 } }, 30, NOW)).stats.hygiene).toBe(50);
  });

  it('уставший питомец не играет', () => {
    const p = newPet(NOW);
    expect(play({ ...p, stats: { ...p.stats, energy: 10 } }, NOW)).toEqual({ ok: false, error: 'tired' });
  });

  it('монеты за мини-игру ограничены', () => {
    expect(coinsForScore(-5)).toBe(0);
    expect(coinsForScore(9)).toBe(3);
    expect(coinsForScore(10_000)).toBe(MAX_MINIGAME_COINS);
    const p = newPet(NOW);
    expect(unwrap(finishMiniGame(p, 30, NOW)).coins).toBe(p.coins + 10);
  });
});

describe('магазин', () => {
  it('покупка списывает монеты, повторно вещь не купить', () => {
    const p = { ...newPet(NOW), coins: 100 };
    const s = unwrap(buy(p, 'h_beanie'));
    expect(s.coins).toBe(60);
    expect(s.owned).toContain('h_beanie');
    expect(buy(s, 'h_beanie')).toEqual({ ok: false, error: 'already_owned' });
  });

  it('не хватает монет', () => {
    expect(buy({ ...newPet(NOW), coins: 5 }, 'h_crown')).toEqual({ ok: false, error: 'not_enough_coins' });
  });

  it('еду можно покупать много раз', () => {
    let s = { ...newPet(NOW), coins: 20 };
    s = unwrap(buy(s, 'f_cake'));
    s = unwrap(buy(s, 'f_cake'));
    expect(s.food.f_cake).toBe(2);
    expect(s.coins).toBe(0);
  });

  it('надеть можно только своё и в правильный слот', () => {
    const p = newPet(NOW);
    expect(equip(p, 'hat', 'h_crown')).toEqual({ ok: false, error: 'not_owned' });
    expect(equip(p, 'hat', 'c_mint')).toEqual({ ok: false, error: 'unknown_item' });
    expect(equip(p, 'color', undefined).ok).toBe(false);
  });
});

describe('sanitize', () => {
  it('мусор превращается в нового питомца', () => {
    expect(sanitize('oops', NOW)).toEqual(newPet(NOW));
    expect(sanitize(null, NOW)).toEqual(newPet(NOW));
  });

  it('чинит подделанные значения', () => {
    const s = sanitize(
      {
        stats: { satiety: 9999, hygiene: -3, energy: 'x', mood: 50 },
        coins: -10,
        owned: ['h_crown', 'nope', 'f_apple'],
        food: { f_apple: 2.7, hack: 5 },
        wear: { hat: 'h_crown', glasses: 'g_shades' },
        ts: NOW + 1e9,
      },
      NOW,
    );
    expect(s.stats.satiety).toBe(100);
    expect(s.stats.hygiene).toBe(5);
    expect(s.coins).toBe(0);
    expect(s.owned).toContain('h_crown');
    expect(s.owned).not.toContain('nope');
    expect(s.food).toEqual({ f_apple: 2 });
    expect(s.wear.hat).toBe('h_crown');
    expect(s.wear.glasses).toBeUndefined();
    expect(s.ts).toBe(NOW);
  });
});

describe('storage', () => {
  it('режет строку на части не длиннее лимита', () => {
    const str = 'a'.repeat(9000);
    const parts = splitChunks(str);
    expect(parts.map((p) => p.length)).toEqual([4096, 4096, 808]);
    expect(parts.join('')).toBe(str);
    expect(chunkKeys('pet', 2)).toEqual(['pet_0', 'pet_1']);
  });
});
