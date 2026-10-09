import { signal } from '@preact/signals';
import { userLanguage } from '../telegram';
import { en } from './en';
import { ru, type Dict } from './ru';

export type Lang = 'ru' | 'en';
const dicts: Record<Lang, Dict> = { ru, en };
const KEY = 'kaplya:lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* localStorage может быть недоступен */
  }
  // Русский по умолчанию, английский — если Telegram на английском.
  return userLanguage()?.startsWith('en') ? 'en' : 'ru';
}

export const lang = signal<Lang>(initialLang());

export function setLang(l: Lang) {
  lang.value = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* не критично */
  }
}

/** Текущий словарь. Читается внутри компонентов — они перерисуются при смене языка. */
export const t = (): Dict => dicts[lang.value];
