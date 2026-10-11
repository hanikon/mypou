/** Тонкая обёртка над window.Telegram.WebApp с проверкой версий и фолбэками для браузера. */

type ButtonParams = {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
};

interface TgButton {
  setParams(p: ButtonParams): TgButton;
  show(): TgButton;
  hide(): TgButton;
  onClick(cb: () => void): TgButton;
  offClick(cb: () => void): TgButton;
}

interface TgWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; language_code?: string; allows_write_to_pm?: boolean };
    start_param?: string;
  };
  version: string;
  colorScheme: 'light' | 'dark';
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  requestWriteAccess?(cb?: (granted: boolean) => void): void;
  openTelegramLink(url: string): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: TgButton;
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  CloudStorage: {
    setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
    getItems(keys: string[], cb: (err: string | null, values?: Record<string, string>) => void): void;
    removeItems(keys: string[], cb?: (err: string | null, ok?: boolean) => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp;

/** Вне Telegram initData пустая — тогда работаем как обычный сайт (для отладки). */
export const inTelegram = !!tg && tg.initData !== '';

const atLeast = (v: string) => inTelegram && tg!.isVersionAtLeast(v);

export const features = {
  cloudStorage: atLeast('6.9'),
  backButton: atLeast('6.1'),
  haptics: atLeast('6.1'),
  verticalSwipes: atLeast('7.7'),
  writeAccess: atLeast('6.9'),
};

export function initTelegram(onTheme: (scheme: 'light' | 'dark') => void) {
  const applyTheme = () =>
    onTheme(tg && inTelegram ? tg.colorScheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme();
  if (!tg || !inTelegram) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    return;
  }
  tg.ready();
  tg.expand();
  // Перетаскивание еды и мыла не должно сворачивать приложение.
  if (features.verticalSwipes) tg.disableVerticalSwipes?.();
  tg.onEvent('themeChanged', applyTheme);
}

export const haptic = {
  tap() {
    if (features.haptics) tg!.HapticFeedback.impactOccurred('light');
  },
  select() {
    if (features.haptics) tg!.HapticFeedback.selectionChanged();
  },
  success() {
    if (features.haptics) tg!.HapticFeedback.notificationOccurred('success');
  },
  error() {
    if (features.haptics) tg!.HapticFeedback.notificationOccurred('error');
  },
};

export function userLanguage(): string | undefined {
  return tg?.initDataUnsafe.user?.language_code;
}

/** Попросить у пользователя разрешение, чтобы бот мог присылать сообщения. */
export function requestWriteAccess(): Promise<boolean> {
  if (!features.writeAccess || !tg?.requestWriteAccess) return Promise.resolve(false);
  return new Promise((res) => tg!.requestWriteAccess!((granted) => res(granted)));
}

/** Поделиться ссылкой через стандартное окно Telegram. */
export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (inTelegram) tg!.openTelegramLink(share);
  else window.open(share, '_blank');
}

/** Подтверждение: нативное окно Telegram или обычный confirm в браузере. */
export function confirmDialog(message: string): Promise<boolean> {
  if (inTelegram && tg!.isVersionAtLeast('6.2') && tg!.showConfirm) {
    return new Promise((res) => tg!.showConfirm!(message, res));
  }
  return Promise.resolve(window.confirm(message));
}

/** Параметр запуска Mini App (?startapp=...). */
export const startParam = (): string | undefined => tg?.initDataUnsafe.start_param;
