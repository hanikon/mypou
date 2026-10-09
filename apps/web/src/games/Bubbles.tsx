import { useEffect, useRef, useState } from 'preact/hooks';
import { coinsForScore, finishMiniGame } from '@kaplya/shared';
import { t } from '../i18n';
import { sfx } from '../sfx';
import { act, overlay, showToast } from '../state/store';
import { haptic } from '../telegram';
import { MainAction, useBackButton } from '../ui/telegramButtons';

const DURATION = 20;
interface Bubble {
  id: number;
  x: number;
  size: number;
  gold: boolean;
  speed: number;
}

/** Мини-игра: лопать всплывающие пузыри. Монеты начисляются только по итогу (на этапе 2 — сервером). */
export function Bubbles() {
  const [phase, setPhase] = useState<'intro' | 'play' | 'done'>('intro');
  const [left, setLeft] = useState(DURATION);
  const [score, setScore] = useState(0);
  const [items, setItems] = useState<Bubble[]>([]);
  const nextId = useRef(0);
  const close = () => (overlay.value = null);
  const ownBack = useBackButton(close);

  useEffect(() => {
    if (phase !== 'play') return;
    const spawn = setInterval(() => {
      const b: Bubble = {
        id: ++nextId.current,
        x: 8 + Math.random() * 76,
        size: 48 + Math.random() * 28,
        gold: Math.random() < 0.12,
        speed: 3 + Math.random() * 2,
      };
      setItems((prev) => [...prev.slice(-14), b]);
    }, 550);
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => {
      clearInterval(spawn);
      clearInterval(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase === 'play' && left <= 0) {
      setPhase('done');
      setItems([]);
    }
  }, [left, phase]);

  const pop = (b: Bubble) => {
    setItems((prev) => prev.filter((x) => x.id !== b.id));
    setScore((s) => s + (b.gold ? 3 : 1));
    haptic.tap();
    sfx.pop();
  };

  const collect = () => {
    if (act((s, now) => finishMiniGame(s, score, now))) {
      sfx.coin();
      haptic.success();
      showToast(`+${coinsForScore(score)} 🪙`);
    }
    close();
  };

  return (
    <div class="overlay game">
      <header class="overlay__head">
        {ownBack && (
          <button class="icon-btn" aria-label={t().close} onClick={close}>
            ✕
          </button>
        )}
        <h2>{t().game.title}</h2>
        {phase === 'play' && (
          <span class="game__hud">
            {t().game.score}: {score} · {t().game.time}: {left}
          </span>
        )}
      </header>
      <div class="game__field">
        {phase === 'intro' && <p class="game__msg">{t().game.rules}</p>}
        {phase === 'done' && <p class="game__msg">{t().game.result(score, coinsForScore(score))}</p>}
        {items.map((b) => (
          <button
            key={b.id}
            class={`bubble ${b.gold ? 'bubble--gold' : ''}`}
            style={{ left: `${b.x}%`, width: `${b.size}px`, height: `${b.size}px`, animationDuration: `${b.speed}s` }}
            onPointerDown={() => pop(b)}
            onAnimationEnd={() => setItems((prev) => prev.filter((x) => x.id !== b.id))}
            aria-label="bubble"
          />
        ))}
      </div>
      {phase === 'intro' && <MainAction text={t().game.start} onClick={() => setPhase('play')} />}
      {phase === 'done' && <MainAction text={t().game.collect} onClick={collect} />}
    </div>
  );
}
