/**
 * Проверка подписи Telegram initData (WebCrypto, работает в Workers и Node 20+).
 * secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 * hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
 * data_check_string — все поля, кроме hash, по алфавиту, "key=value" через "\n".
 */

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  /** Пользователь разрешил боту писать ему. */
  allows_write_to_pm?: boolean;
}

export type InitDataResult =
  | { ok: true; user: TgUser; authDate: number; startParam?: string }
  | { ok: false; reason: 'missing_hash' | 'bad_hash' | 'expired' | 'bad_user' };

const enc = new TextEncoder();

async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  // Копии через new Uint8Array — чтобы типы совпали и в Node, и в Workers.
  const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array(enc.encode(msg))));
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Сравнение за постоянное время, чтобы не подсказывать подпись по таймингу. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<InitDataResult> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(expected, hash.toLowerCase())) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date'));
  // Подпись верна, но данные старые (или из будущего) — не принимаем.
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 60) {
    return { ok: false, reason: 'expired' };
  }

  let user: TgUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return { ok: false, reason: 'bad_user' };
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: 'bad_user' };

  return { ok: true, user, authDate, startParam: params.get('start_param') ?? undefined };
}
