import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, serverMode, type FriendBrief } from '../api';
import { t } from '../i18n';
import { fail, overlay, showToast } from '../state/store';
import { haptic, shareLink } from '../telegram';
import { useBackButton } from './telegramButtons';

const FACE: Record<string, string> = { happy: '😊', neutral: '🙂', sad: '😢', sleep: '😴' };

export function Friends() {
  const close = () => (overlay.value = null);
  const ownBack = useBackButton(close);
  const [data, setData] = useState<{ invite: string | null; friends: FriendBrief[] } | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    api
      .friends()
      .then(setData)
      .catch((e) => {
        setError(true);
        fail(e instanceof ApiError ? e.code : 'server');
      });
  };
  useEffect(() => {
    if (serverMode) load();
  }, []);

  const invite = () => {
    if (!data?.invite) return;
    haptic.tap();
    shareLink(data.invite, t().friends.inviteText);
  };
  const copy = async () => {
    if (!data?.invite) return;
    try {
      await navigator.clipboard.writeText(data.invite);
      showToast(t().friends.copied);
    } catch {
      /* буфер обмена может быть недоступен */
    }
  };

  return (
    <div class="overlay friends">
      <header class="overlay__head">
        {ownBack && (
          <button class="icon-btn" aria-label={t().close} onClick={close}>
            ✕
          </button>
        )}
        <h2>{t().friends.title}</h2>
      </header>
      <div class="list">
        {!serverMode ? (
          <p class="list__note">{t().settings.offline}</p>
        ) : error ? (
          <button class="btn" onClick={load}>
            {t().retry}
          </button>
        ) : !data ? (
          <div class="spinner" aria-label={t().loading} />
        ) : (
          <>
            {data.invite ? (
              <div class="invite">
                <button class="btn btn--accent" onClick={invite}>
                  ✉️ {t().friends.invite}
                </button>
                <button class="invite__link" onClick={copy}>
                  {data.invite}
                </button>
              </div>
            ) : (
              <p class="list__note">{t().friends.noLink}</p>
            )}
            {data.friends.length === 0 ? (
              <p class="list__note">{t().friends.empty}</p>
            ) : (
              data.friends.map((f) => (
                <div class="row" key={f.id}>
                  <span>
                    {FACE[f.emotion ?? ''] ?? '🫧'} {f.name}
                  </span>
                  <button
                    class="btn btn--small"
                    onClick={() => {
                      haptic.tap();
                      overlay.value = { kind: 'visit', id: f.id };
                    }}
                  >
                    {t().friends.visit}
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
