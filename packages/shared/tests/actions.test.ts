import { describe, expect, it } from 'vitest';
import { applyAction, cappedCoins, checkMiniGame, MINIGAME, parseAction } from '../src/actions';
import { newPet } from '../src/pet';

const NOW = 1_700_000_000_000;

describe('parseAction', () => {
  it('принимает корректные запросы', () => {
    expect(parseAction({ type: 'feed', item: 'f_apple' })).toEqual({ type: 'feed', item: 'f_apple' });
    expect(parseAction({ type: 'equip', slot: 'hat', item: null })).toEqual({ type: 'equip', slot: 'hat', item: null });
    expect(parseAction({ type: 'sleep', on: true })).toEqual({ type: 'sleep', on: true });
  });

  it('ограничивает мытьё и отбрасывает мусор', () => {
    expect(parseAction({ type: 'wash', amount: 9999 })).toEqual({ type: 'wash', amount: 60 });
    expect(parseAction({ type: 'wash', amount: 'x' })).toBeNull();
    expect(parseAction({ type: 'feed', item: '../etc' })).toBeNull();
    expect(parseAction({ type: 'equip', slot: 'food', item: 'f_apple' })).toBeNull();
    expect(parseAction({ type: 'addCoins', amount: 1e6 })).toBeNull();
    expect(parseAction(null)).toBeNull();
  });
});

describe('applyAction', () => {
  it('применяет правила из shared', () => {
    const r = applyAction({ ...newPet(NOW), coins: 0 }, { type: 'buy', item: 'h_crown' }, NOW);
    expect(r).toEqual({ ok: false, error: 'not_enough_coins' });
  });
});

describe('мини-игра на сервере', () => {
  it('без старта, слишком быстро и слишком поздно — отказ', () => {
    expect(checkMiniGame(null, NOW, 10)).toEqual({ ok: false, error: 'no_game' });
    expect(checkMiniGame(NOW - 5_000, NOW, 10)).toEqual({ ok: false, error: 'too_fast' });
    expect(checkMiniGame(NOW - 600_000, NOW, 10)).toEqual({ ok: false, error: 'too_late' });
  });

  it('обрезает неправдоподобные очки', () => {
    expect(checkMiniGame(NOW - 21_000, NOW, 1e9)).toEqual({ ok: true, score: MINIGAME.maxScore });
    expect(checkMiniGame(NOW - 21_000, NOW, -3)).toEqual({ ok: true, score: 0 });
  });

  it('дневной лимит монет', () => {
    expect(cappedCoins(20, 0)).toBe(20);
    expect(cappedCoins(20, MINIGAME.dailyCoins - 5)).toBe(5);
    expect(cappedCoins(20, MINIGAME.dailyCoins)).toBe(0);
  });
});
