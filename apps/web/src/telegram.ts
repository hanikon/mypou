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
    user?: { id: number; first_name: string; language_code?: string };
    start_param?: string;
  };
  version: string;
  colorScheme: 'light' | 'dark';
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
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
