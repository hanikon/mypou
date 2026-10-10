import { useState } from 'preact/hooks';
import { api, ApiError, serverMode, type Settings as S } from '../api';
import { lang, setLang, t } from '../i18n';
import { soundOn, toggleSound } from '../sfx';
import { askWriteAccess, fail, overlay, saveSettings, settings, showToast } from '../state/store';
import { features, haptic } from '../telegram';
import { useBackButton } from './telegramButtons';

type Pref = 'notify' | 'notify_hunger' | 'notify_social' | 'notify_game';
const PREFS: { key: Pref; label: () => string }[] = [
  { key: 'notify', label: () => t().settings.all },
  { key: 'notify_hunger', label: () => t().settings.hunger },
  { key: 'notify_social', label: () => t().settings.social },
  { key: 'notify_game', label: () => t().settings.game },
];

function Toggle({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button class="row" role="switch" aria-checked={on} disabled={disabled} onClick={onChange}>
      <span>{label}</span>
      <i class={`switch ${on ? 'is-on' : ''}`} aria-hidden="true" />
    </button>
  );
}

export function Settings() {
  const close = () => (overlay.value = null);
  const ownBack = useBackButton(close);
  const s = settings.value;
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.notifyTest();
      settings.value = r.settings;
      if (r.result === 'sent') {
        haptic.success();
        showToast(t().settings.testSent);
      } else if (r.result === 'pending') showToast(t().settings.testLater);
      else {
        haptic.error();
        showToast(t().settings.testFailed, 'error');
      }
    } catch (e) {
      fail(e instanceof ApiError ? e.code : 'server');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div class="overlay settings">
      <header class="overlay__head">
        {ownBack && (
          <button class="icon-btn" aria-label={t().close} onClick={close}>
            ✕
          </button>
        )}
        <h2>{t().settings.title}</h2>
      </header>
      <div class="list">
        <Toggle on={soundOn.value} label={`🔊 ${t().settings.sound}`} onChange={toggleSound} />
        <div class="row">
          <span>🌐 {t().settings.language}</span>
          <span class="seg">
            {(['ru', 'en'] as const).map((l) => (
              <button key={l} class={lang.value === l ? 'is-active' : ''} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </span>
        </div>

        <h3 class="list__title">{t().settings.notifications}</h3>
        {!serverMode || !s ? (
          <p class="list__note">{t().settings.offline}</p>
        ) : (
          <>
            <div class={`status ${s.can_message ? 'is-ok' : 'is-warn'}`}>
              <p>{s.can_message ? t().settings.canWrite : t().settings.cannotWrite}</p>
              {!s.can_message && (
                <>
                  {features.writeAccess && (
                    <button class="btn btn--accent" onClick={() => void askWriteAccess()}>
                      {t().settings.allow}
                    </button>
                  )}
                  <small>{t().settings.allowHint}</small>
                </>
              )}
            </div>
            {PREFS.map((p) => (
              <Toggle
                key={p.key}
                on={s[p.key]}
                label={p.label()}
                disabled={p.key !== 'notify' && !s.notify}
                onChange={() => {
                  haptic.select();
                  void saveSettings({ [p.key]: !s[p.key] } as Partial<S>);
                }}
              />
            ))}
            <button class="btn" disabled={testing} onClick={test}>
              🔔 {t().settings.test}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
