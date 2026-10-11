import { describe, expect, it } from 'vitest';
import { aiMove, applyMove, bestMove, EMPTY_BOARD, outcomeOf, other, winningLine, type Mark } from '../src/tictactoe';

describe('правила', () => {
  it('определяет победу по строке, столбцу и диагонали', () => {
    expect(outcomeOf('XXX......')).toBe('X');
    expect(outcomeOf('O..O..O..')).toBe('O');
    expect(outcomeOf('X...X...X')).toBe('X');
    expect(outcomeOf('..O.O.O..')).toBe('O');
    expect(winningLine('..O.O.O..')).toEqual([2, 4, 6]);
  });

  it('ничья и незаконченная партия', () => {
    expect(outcomeOf('XOXXOOOXX')).toBe('D');
    expect(outcomeOf(EMPTY_BOARD)).toBeNull();
  });

  it('проверяет ход', () => {
    expect(applyMove(EMPTY_BOARD, 'X', 'X', 4)).toEqual({ ok: true, board: '....X....', turn: 'O', outcome: null });
    expect(applyMove(EMPTY_BOARD, 'X', 'O', 4)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(applyMove('....X....', 'O', 'O', 4)).toEqual({ ok: false, error: 'occupied' });
    for (const bad of [-1, 9, 1.5, '4', null]) {
      expect(applyMove(EMPTY_BOARD, 'X', 'X', bad)).toEqual({ ok: false, error: 'bad_cell' });
    }
    expect(applyMove('XXX.OO...', 'O', 'O', 3)).toEqual({ ok: false, error: 'finished' });
    expect(applyMove('XX.OO....', 'X', 'X', 2)).toMatchObject({ ok: true, outcome: 'X' });
  });
});

describe('minimax', () => {
  it('забирает победу и блокирует соперника', () => {
    expect(bestMove('XX.OO....', 'X')).toBe(2);
    expect(bestMove('XX..O....', 'O')).toBe(2);
  });

  /** Перебираем все возможные игры человека против компьютера. */
  function humanCanWin(board: string, toMove: Mark, ai: Mark): boolean {
    const out = outcomeOf(board);
    if (out) return out === other(ai);
    if (toMove === ai) {
      const cell = bestMove(board, ai, () => 0);
      return humanCanWin(board.slice(0, cell) + ai + board.slice(cell + 1), other(ai), ai);
    }
    for (let i = 0; i < 9; i++) {
      if (board[i] !== '.') continue;
      if (humanCanWin(board.slice(0, i) + toMove + board.slice(i + 1), ai, ai)) return true;
    }
    return false;
  }

  it('сложный компьютер никогда не проигрывает ни за X, ни за O', () => {
    expect(humanCanWin(EMPTY_BOARD, 'X', 'O')).toBe(false);
    expect(humanCanWin(EMPTY_BOARD, 'X', 'X')).toBe(false);
  });

  it('лёгкий компьютер всегда ходит в свободную клетку', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 200; n++) {
      const b = 'XO.X.O..X';
      const c = aiMove(b, 'O', 'easy', rand);
      expect(b[c]).toBe('.');
    }
  });
});
