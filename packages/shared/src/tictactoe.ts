/** Крестики-нолики: доска — строка из 9 символов ".", "X", "O" (слева направо, сверху вниз). */

export type Mark = 'X' | 'O';
export type Outcome = Mark | 'D'; // D — ничья
export const EMPTY_BOARD = '.........';

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export const isBoard = (b: unknown): b is string => typeof b === 'string' && /^[.XO]{9}$/.test(b);
export const other = (m: Mark): Mark => (m === 'X' ? 'O' : 'X');

/** Победитель, ничья или null (игра идёт). */
export function outcomeOf(board: string): Outcome | null {
  for (const [a, b, c] of LINES) {
    const m = board[a];
    if (m !== '.' && m === board[b] && m === board[c]) return m as Mark;
  }
  return board.includes('.') ? null : 'D';
}

/** Выигрышная линия (для подсветки) или null. */
export function winningLine(board: string): readonly [number, number, number] | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] !== '.' && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

export type MoveError = 'finished' | 'not_your_turn' | 'bad_cell' | 'occupied';
export type MoveResult =
  | { ok: true; board: string; turn: Mark; outcome: Outcome | null }
  | { ok: false; error: MoveError };

/** Проверяет и применяет ход: чей ход, свободна ли клетка, не закончена ли партия. */
export function applyMove(board: string, turn: Mark, mark: Mark, cell: unknown): MoveResult {
  if (!isBoard(board) || outcomeOf(board) !== null) return { ok: false, error: 'finished' };
  if (mark !== turn) return { ok: false, error: 'not_your_turn' };
  if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, error: 'bad_cell' };
  if (board[cell] !== '.') return { ok: false, error: 'occupied' };
  const next = board.slice(0, cell) + mark + board.slice(cell + 1);
  return { ok: true, board: next, turn: other(mark), outcome: outcomeOf(next) };
}

/* ---------------- компьютер (minimax) ---------------- */

const memo = new Map<string, number>();

/** Оценка позиции для того, кто ходит: +10 — выигрыш, −10 — проигрыш (быстрее — лучше). */
function score(board: string, toMove: Mark, depth: number): number {
  const out = outcomeOf(board);
  if (out === 'D') return 0;
  if (out) return out === toMove ? 10 - depth : depth - 10;
  const key = board + toMove + depth;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let best = -Infinity;
  for (let i = 0; i < 9; i++) {
    if (board[i] !== '.') continue;
    const next = board.slice(0, i) + toMove + board.slice(i + 1);
    best = Math.max(best, -score(next, other(toMove), depth + 1));
  }
  memo.set(key, best);
  return best;
}

/** Лучший ход для mark. Среди равных ходов выбирает случайный, чтобы игры не повторялись. */
export function bestMove(board: string, mark: Mark, rand: () => number = Math.random): number {
  let best = -Infinity;
  let moves: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] !== '.') continue;
    const next = board.slice(0, i) + mark + board.slice(i + 1);
    const s = -score(next, other(mark), 1);
    if (s > best) {
      best = s;
      moves = [i];
    } else if (s === best) moves.push(i);
  }
  return moves[Math.floor(rand() * moves.length)] ?? -1;
}

export type AiLevel = 'easy' | 'hard';

/** Ход компьютера: «сложный» играет идеально, «лёгкий» часто ходит наугад. */
export function aiMove(board: string, mark: Mark, level: AiLevel, rand: () => number = Math.random): number {
  if (level === 'easy' && rand() < 0.55) {
    const free = [...board].flatMap((c, i) => (c === '.' ? [i] : []));
    return free[Math.floor(rand() * free.length)] ?? -1;
  }
  return bestMove(board, mark, rand);
}

/** Награда за победу в партии с другом и лимит таких наград в сутки. */
export const TTT_WIN_COINS = 15;
export const TTT_DAILY_REWARDS = 5;
