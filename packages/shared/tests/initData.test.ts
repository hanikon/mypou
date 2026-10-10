import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from '../src/initData';

const TOKEN = '123456:TEST-token-not-real';
const NOW = 1_760_000_000;

/** Независимая реализация подписи через node:crypto — эталон для проверки. */
function sign(fields: Record<string, string>, token = TOKEN) {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Аня', language_code: 'ru' });
const base = { auth_date: String(NOW - 10), query_id: 'AAE', user, signature: 'abc' };

describe('verifyInitData', () => {
  it('принимает правильную подпись', async () => {
    const r = await verifyInitData(sign({ ...base, start_param: 'invite_x1' }), TOKEN, 3600, NOW);
    expect(r).toMatchObject({ ok: true, user: { id: 42, first_name: 'Аня' }, startParam: 'invite_x1' });
  });

  it('отклоняет подпись другим токеном', async () => {
    expect(await verifyInitData(sign(base, '999:other'), TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('отклоняет изменённые данные', async () => {
    const forged = sign(base).replace('%22id%22%3A42', '%22id%22%3A43');
    expect(await verifyInitData(forged, TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('отклоняет без hash и пустую строку', async () => {
    expect(await verifyInitData('', TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'missing_hash' });
    expect(await verifyInitData('user=1', TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'missing_hash' });
  });

  it('отклоняет просроченные и «из будущего»', async () => {
    const old = sign({ ...base, auth_date: String(NOW - 7200) });
    expect(await verifyInitData(old, TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'expired' });
    const future = sign({ ...base, auth_date: String(NOW + 3600) });
    expect(await verifyInitData(future, TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('отклоняет подписанные, но кривые данные пользователя', async () => {
    const bad = sign({ ...base, user: '{"id":-1}' });
    expect(await verifyInitData(bad, TOKEN, 3600, NOW)).toEqual({ ok: false, reason: 'bad_user' });
  });
});
