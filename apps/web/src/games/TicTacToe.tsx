import { useEffect, useRef, useState } from 'preact/hooks';
import { aiMove, applyMove, EMPTY_BOARD, outcomeOf, sanitize, tick, TTT_WIN_COINS, type AiLevel } from '@kaplya/shared';
import { api, ApiError, serverMode, type GamesList, type GameView } from '../api';
import { t } from '../i18n';
import { sfx } from '../sfx';
import { fail, overlay, pet, showToast } from '../state/store';
import { confirmDialog, haptic } from '../telegram';
import { useBackButton } from '../ui/telegramButtons';
import { Board } from './Board';

type Screen = { kind: 'menu' } | { kind: 'ai'; level: AiLevel } | { kind: 'online'; id: string };

export function TicTacToe({ gameId }: { gameId?: string }) {
  const [screen, setScreen] = useState<Screen>(gameId ? { kind: 'online', id: gameId } : { kind: 'menu' });
  const back = () => (screen.kind === 'menu' ? (overlay.value = null) : setScreen({ kind: 'menu' }));
  const ownBack = useBackButton(back);

  return (
    <div class="overlay ttt">
      <header class="overlay__head">
        {ownBack && (
          <button class="icon-btn" aria-label={t().close} onClick={back}>
            {screen.kind === 'menu' ? '✕' : '←'}
          </button>
        )}
        <h2>{t().ttt.title}</h2>
      </header>
      {screen.kind === 'menu' && <Menu onOpen={setScreen} />}
      {screen.kind === 'ai' && <AiGame key={screen.level} level={screen.level} />}
      {screen.kind === 'online' && <OnlineGame id={screen.id} />}
    </div>
  );
}

/* ---------------- меню ---------------- */

function Menu({ onOpen }: { onOpen: (s: Screen) => void }) {
  const [list, setList] = useState<GamesList | null>(null);
  const [friends, setFriends] = useState<{ id: number; name: string }[] | null>(null);

  useEffect(() => {
    if (!serverMode) return;
    Promise.all([api.games(), api.friends()])
      .then(([g, f]) => {
        setList(g);
        setFriends(f.friends);
      })
      .catch((e) => fail(e instanceof ApiError ? e.code : 'server'));
  }, []);

  const playWith = async (friend: number) => {
    haptic.tap();
    const active = list?.active.find((g) => g.opponent.id === friend);
    if (active) return onOpen({ kind: 'online', id: active.id });
    try {
      const { game } = await api.newGame(friend);
      onOpen({ kind: 'online', id: game.id });
    } catch (e) {
      fail(e instanceof ApiError ? e.code : 'server');
    }
  };

  return (
    <div class="list">
      <h3 class="list__title">{t().ttt.vsAi}</h3>
      <div class="ttt-levels">
        {(['easy', 'hard'] as const).map((l) => (
          <button key={l} class="btn" onClick={() => onOpen({ kind: 'ai', level: l })}>
            🤖 {t().ttt[l]}
          </button>
        ))}
      </div>

      <h3 class="list__title">{t().ttt.vsFriend}</h3>
      {!serverMode ? (
        <p class="list__note">{t().ttt.offline}</p>
      ) : !friends || !list ? (
        <div class="spinner" />
      ) : friends.length === 0 ? (
        <p class="list__note">{t().ttt.noFriends}</p>
      ) : (
        <>
          {friends.map((f) => {
            const s = list.score[f.id];
            const active = list.active.find((g) => g.opponent.id === f.id);
            const myTurn = active && active.turn === active.me;
            return (
              <div class="row" key={f.id}>
                <span>
                  <b>{f.name}</b>
                  {s && <small class="row__sub">{t().ttt.score(s.wins, s.losses, s.draws)}</small>}
                </span>
                <button class={`btn btn--small ${myTurn ? 'btn--accent' : ''}`} onClick={() => playWith(f.id)}>
                  {active ? t().ttt.resume : t().ttt.play}
                </button>
              </div>
            );
          })}
          <p class="list__note">{t().ttt.winsCap}</p>
          {list.history.length > 0 && <h3 class="list__title">{t().ttt.history}</h3>}
          {list.history.slice(0, 10).map((g) => (
            <div class="row row--static" key={g.id}>
              <span>
                {g.winner === 'D' ? '🤝' : g.winner === g.me ? '🏆' : '😅'} {g.opponent.name}
              </span>
              <small>{g.finishedAt ? new Date(g.finishedAt).toLocaleDateString() : ''}</small>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- против компьютера (без монет, всё на устройстве) ---------------- */

function AiGame({ level }: { level: AiLevel }) {
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [humanFirst, setHumanFirst] = useState(true);
  const human = humanFirst ? 'X' : 'O';
  const ai = humanFirst ? 'O' : 'X';
  const outcome = outcomeOf(board);
  const filled = 9 - [...board].filter((c) => c === '.').length;
  const turn = filled % 2 === 0 ? 'X' : 'O';
  const aiTurn = !outcome && turn === ai;

  useEffect(() => {
    if (!aiTurn) return;
    const id = setTimeout(() => {
      const cell = aiMove(board, ai, level);
      const r = applyMove(board, ai, ai, cell);
      if (r.ok) {
        setBoard(r.board);
        sfx.pop();
      }
    }, 450);
    return () => clearTimeout(id);
  }, [board, aiTurn]);

  useEffect(() => {
    if (!outcome) return;
    if (outcome === human) {
      sfx.coin();
      haptic.success();
    } else if (outcome !== 'D') haptic.error();
  }, [outcome]);

  const click = (cell: number) => {
    const r = applyMove(board, turn, human, cell);
    if (!r.ok) return;
    haptic.tap();
    sfx.pop();
    setBoard(r.board);
  };

  return (
    <div class="ttt-game">
      <p class="ttt-status">
        {outcome
          ? outcome === 'D'
            ? t().ttt.draw
            : outcome === human
              ? t().ttt.win
              : t().ttt.lose
          : aiTurn
            ? t().ttt.aiThinking
            : t().ttt.yourTurn}
      </p>
      <Board board={board} disabled={!!outcome || aiTurn} onCell={click} />
      <p class="ttt-sub">{t().ttt.you(human)}</p>
      {outcome && (
        <button
          class="btn btn--accent"
          onClick={() => {
            setHumanFirst((v) => !v);
            setBoard(EMPTY_BOARD);
          }}
        >
          {t().ttt.again}
        </button>
      )}
    </div>
  );
}

/* ---------------- с другом: ходы проверяет сервер, синхронизация опросом раз в 2 с ---------------- */

function OnlineGame({ id }: { id: string }) {
  const [game, setGame] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const prevStatus = useRef<string | null>(null);

  const refresh = async () => {
    try {
      const { game: g } = await api.game(id);
      setGame((old) => {
        if (old && g.moveNo > old.moveNo && g.status === 'playing' && g.turn === g.me) {
          haptic.tap();
          sfx.pop();
        }
        return g;
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_game') {
        fail('no_game');
        overlay.value = { kind: 'ttt' };
      }
    }
  };

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, 2000);
    };
    start();
    return () => clearInterval(timer);
  }, [id]);

  // Конец партии: звук, вибрация, награда.
  useEffect(() => {
    if (!game) return;
    if (prevStatus.current === 'playing' && game.status === 'finished') {
      if (game.winner === game.me) {
        sfx.coin();
        haptic.success();
      } else if (game.winner !== 'D') haptic.error();
    }
    prevStatus.current = game.status;
  }, [game?.status]);

  if (!game) return <div class="spinner" />;

  const myTurn = game.status === 'playing' && game.turn === game.me;

  const click = async (cell: number) => {
    if (!myTurn || busy) return;
    const local = applyMove(game.board, game.turn, game.me, cell);
    if (!local.ok) return;
    haptic.tap();
    sfx.pop();
    const before = game;
    // Сразу рисуем ход, сервер подтвердит или откатит.
    setGame({ ...game, board: local.board, turn: local.turn });
    setBusy(true);
    try {
      const r = await api.move(id, cell, before.moveNo);
      setGame(r.game);
      if (r.pet) {
        const coinsBefore = pet.value?.coins ?? 0;
        pet.value = tick(sanitize(r.pet, Date.now()), Date.now());
        const gained = pet.value.coins - coinsBefore;
        if (gained > 0) showToast(t().ttt.reward(gained));
      }
    } catch (e) {
      setGame(before);
      fail(e instanceof ApiError ? e.code : 'server');
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const giveUp = async () => {
    if (!(await confirmDialog(t().ttt.resignConfirm))) return;
    try {
      setGame((await api.resign(id)).game);
    } catch (e) {
      fail(e instanceof ApiError ? e.code : 'server');
    }
  };

  const status =
    game.status === 'finished'
      ? game.winner === 'D'
        ? t().ttt.draw
        : game.winner === game.me
          ? t().ttt.win
          : t().ttt.lose
      : myTurn
        ? t().ttt.yourTurn
        : t().ttt.theirTurn;

  return (
    <div class="ttt-game">
      <p class="ttt-vs">
        {t().ttt.you(game.me)} · {t().ttt.opponent(game.opponent.name)}
      </p>
      <p class={`ttt-status ${myTurn ? 'is-mine' : ''}`}>{status}</p>
      <Board board={game.board} disabled={!myTurn || busy} onCell={click} />
      {game.status === 'finished' && game.winner === game.me && <p class="ttt-sub">{t().ttt.winsCap} ({TTT_WIN_COINS} 🪙)</p>}
      {game.status === 'playing' ? (
        <button class="btn" onClick={giveUp}>
          🏳️ {t().ttt.resign}
        </button>
      ) : (
        <button
          class="btn btn--accent"
          onClick={async () => {
            try {
              const { game: g } = await api.newGame(game.opponent.id);
              overlay.value = { kind: 'ttt', gameId: g.id };
            } catch (e) {
              fail(e instanceof ApiError ? e.code : 'server');
            }
          }}
        >
          {t().ttt.again}
        </button>
      )}
    </div>
  );
}
