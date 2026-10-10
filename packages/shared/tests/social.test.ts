import { describe, expect, it } from 'vitest';
import { deliveryOutcome, hungryKey, isHungryReminderDue, MAX_ATTEMPTS, parseInvite, visitKey } from '../src/social';

const NOW = 1_760_000_000_000;
const stats = (satiety: number) => ({ satiety, hygiene: 80, energy: 80, mood: 80 });

describe('parseInvite', () => {
  it('достаёт код', () => {
    expect(parseInvite('invite_Ab12Cd34')).toBe('Ab12Cd34');
  });
  it('отбрасывает чужое', () => {
    for (const s of [undefined, null, '', 'invite_', 'invite_short', 'invite_bad-chars!', 'game_123', 'invite_' + 'a'.repeat(30)]) {
      expect(parseInvite(s)).toBeNull();
    }
  });
});

describe('deliveryOutcome', () => {
  it('успех', () => {
    expect(deliveryOutcome(null, 1, NOW)).toEqual({ status: 'sent' });
  });

  it('429 — ждём retry_after', () => {
    expect(deliveryOutcome({ code: 429, retryAfter: 7 }, 1, NOW)).toMatchObject({ status: 'pending', nextAt: NOW + 7000 });
  });

  it('бот заблокирован или чат не найден — больше не пытаемся', () => {
    expect(deliveryOutcome({ code: 403, description: 'Forbidden: bot was blocked by the user' }, 1, NOW)).toMatchObject({
      status: 'dead',
      blocked: true,
    });
    expect(deliveryOutcome({ code: 400, description: 'Bad Request: chat not found' }, 1, NOW)).toMatchObject({
      status: 'dead',
      blocked: true,
    });
  });

  it('битое сообщение не повторяем, но пользователя не помечаем', () => {
    expect(deliveryOutcome({ code: 400, description: "can't parse entities" }, 1, NOW)).toMatchObject({
      status: 'dead',
      blocked: false,
    });
  });

  it('сеть и 5xx — повтор с нарастающей паузой до лимита попыток', () => {
    const a = deliveryOutcome({}, 1, NOW);
    const b = deliveryOutcome({ code: 502 }, 4, NOW);
    expect(a).toMatchObject({ status: 'pending', nextAt: NOW + 60_000 });
    expect(b).toMatchObject({ status: 'pending', nextAt: NOW + 8 * 60_000 });
    expect(deliveryOutcome({ code: 500 }, 9, NOW)).toMatchObject({ status: 'pending', nextAt: NOW + 60 * 60_000 });
    expect(deliveryOutcome({ code: 500 }, MAX_ATTEMPTS, NOW)).toMatchObject({ status: 'dead' });
  });
});

describe('напоминание о голоде', () => {
  it('только если голоден и давно не заходил', () => {
    expect(isHungryReminderDue(stats(10), NOW - 2 * 3600_000, NOW)).toBe(true);
    expect(isHungryReminderDue(stats(10), NOW - 60_000, NOW)).toBe(false);
    expect(isHungryReminderDue(stats(60), NOW - 2 * 3600_000, NOW)).toBe(false);
  });

  it('ключи защищают от повторов в пределах окна', () => {
    expect(hungryKey(1, NOW)).toBe(hungryKey(1, NOW + 60_000));
    expect(hungryKey(1, NOW)).not.toBe(hungryKey(1, NOW + 13 * 3600_000));
    expect(visitKey(1, 2, NOW)).not.toBe(visitKey(2, 1, NOW));
  });
});
