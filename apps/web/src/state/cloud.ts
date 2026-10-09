import { chunkKeys, countKey, splitChunks } from '@kaplya/shared';
import { features, tg } from '../telegram';

/** Хранилище "ключ-значение": CloudStorage в Telegram, localStorage в браузере. */
interface KV {
  get(keys: string[]): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const cloudKV: KV = {
  get: (keys) =>
    new Promise((res, rej) =>
      tg!.CloudStorage.getItems(keys, (err, v) => (err ? rej(new Error(err)) : res(v ?? {}))),
    ),
  set: (key, value) =>
    new Promise((res, rej) => tg!.CloudStorage.setItem(key, value, (err) => (err ? rej(new Error(err)) : res()))),
  remove: (keys) =>
    new Promise((res, rej) => tg!.CloudStorage.removeItems(keys, (err) => (err ? rej(new Error(err)) : res()))),
};

const LS_PREFIX = 'kaplya:';
const localKV: KV = {
  async get(keys) {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = localStorage.getItem(LS_PREFIX + k);
      if (v !== null) out[k] = v;
    }
    return out;
  },
  async set(key, value) {
    localStorage.setItem(LS_PREFIX + key, value);
  },
  async remove(keys) {
    for (const k of keys) localStorage.removeItem(LS_PREFIX + k);
  },
};

const kv: KV = features.cloudStorage ? cloudKV : localKV;

/** Сколько частей лежит в хранилище сейчас — чтобы удалить лишние после сжатия. */
let lastCount = 0;

/** Читает JSON, разбитый на части. null — сохранения ещё нет. Ошибки чтения пробрасываются. */
export async function loadJson(prefix: string): Promise<unknown | null> {
  const head = await kv.get([countKey(prefix)]);
  const n = Number(head[countKey(prefix)]);
  if (!Number.isInteger(n) || n <= 0) return null;
  lastCount = n;
  const keys = chunkKeys(prefix, n);
  const parts = await kv.get(keys);
  const str = keys.map((k) => parts[k] ?? '').join('');
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export async function saveJson(prefix: string, value: unknown): Promise<void> {
  const chunks = splitChunks(JSON.stringify(value));
  const keys = chunkKeys(prefix, chunks.length);
  await Promise.all(keys.map((k, i) => kv.set(k, chunks[i]!)));
  // Счётчик пишем последним: пока он старый, читается прежняя целая версия.
  await kv.set(countKey(prefix), String(chunks.length));
  if (lastCount > chunks.length) await kv.remove(chunkKeys(prefix, lastCount).slice(chunks.length));
  lastCount = chunks.length;
}
