/**
 * Telegram CloudStorage: значение до 4096 символов, ключ до 128 символов [A-Za-z0-9_-].
 * Длинный JSON режем на части: "<prefix>_n" хранит число частей, "<prefix>_0..n-1" — сами части.
 */
export const CLOUD_VALUE_LIMIT = 4096;

export function splitChunks(value: string, size = CLOUD_VALUE_LIMIT): string[] {
  if (value.length === 0) return [''];
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

export function chunkKeys(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}_${i}`);
}

export const countKey = (prefix: string) => `${prefix}_n`;
