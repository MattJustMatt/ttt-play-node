export type Board = {
  id: number;
  positions: Array<number>;
  winner: number | null;
  winningLine: Array<number> | null;
};

export type Game = {
  id: number;
  boards: Array<Board>;
  winner: BoardPiece | null;
  winningLine: Array<number> | null;
  nextPiece: BoardPiece;
  winnerUsername: string | null;
};

export type SanitizedPlayer = {
  id: number;
  username: string | null;
  playingFor: BoardPiece;
  score: number;
  online: boolean;
};

export enum BoardPiece {
  DRAW,
  X,
  O
}