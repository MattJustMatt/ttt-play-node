import { Board, BoardPiece } from "./types/GameTypes";

export const searchWinner = (positions: Array<BoardPiece>): [BoardPiece | null, Array<number> | null] => {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];
    if (positions[a] && positions[a] === positions[b] && positions[a] === positions[c]) {
      // -1 is special case for a hard draw in the full game
      return [positions[a] as number !== -1 ? positions[a] : BoardPiece.DRAW, lines[i]];
    }
  }

  let occupied = 0;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== BoardPiece.DRAW) occupied++;
    if (occupied === positions.length) return [BoardPiece.DRAW, null];
  }

  return [null, null];
}

export const generatePositionsFromBoards = (boards: Array<Board>): Array<number> => {
  const positions = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  // This is a hack and could be improved. We set the board positin to -1 because typically a single board (i.e. not part of a group) is a draw if all
  // the spaces are occupied however, in a group the board winner itself may be a draw which would be treated as an empty space when we check if all squares are occupied
  // Tl;dr setting boards with no winner to -1 acts as distinct type of "Draw" that is different from an empty space (typical DRAW enum is 0 (empty space))
  for (let i = 0; i < positions.length; i++) {
    if (boards[i].winner === null) positions[i] = BoardPiece.DRAW;
    else if (boards[i].winner === BoardPiece.DRAW) positions[i] = -1
    else positions[i] = boards[i].winner!;
  }
  
  return positions;
}
