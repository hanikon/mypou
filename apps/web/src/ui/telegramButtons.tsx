import { useEffect, useRef } from 'preact/hooks';
import { features, inTelegram, tg } from '../telegram';

/** Нативная MainButton в Telegram, обычная кнопка внизу экрана в браузере. */
export function MainAction({ text, onClick, disabled }: { text: string; onClick: () => void; disabled?: boolean }) {
  const cb = useRef(onClick);
  cb.current = onClick;

  useEffect(() => {
    if (!inTelegram) return;
    const handler = () => cb.current();
    tg!.MainButton.onClick(handler);
    return () => {
      tg!.MainButton.offClick(handler);
      tg!.MainButton.hide();
    };
  }, []);

  useEffect(() => {
    if (!inTelegram) return;
    tg!.MainButton.setParams({ text, is_active: !disabled, is_visible: true });
  }, [text, disabled]);

  if (inTelegram) return null;
  return (
    <button class="btn btn--main" disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}

/** Нативная BackButton. Возвращает true, если нужна своя кнопка «назад» (вне Telegram). */
export function useBackButton(onBack: () => void): boolean {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!features.backButton) return;
    const handler = () => cb.current();
    tg!.BackButton.onClick(handler);
    tg!.BackButton.show();
    return () => {
      tg!.BackButton.offClick(handler);
      tg!.BackButton.hide();
    };
  }, []);
  return !features.backButton;
}
