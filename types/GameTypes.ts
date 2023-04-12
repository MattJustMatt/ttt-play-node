export type Board = {
    id: number;
    positions: Array<number>;
    winner: number | null;
    winningLine: Array<number> | null;
};

export type Game = {
    id: number;
    boards: Array<Board>;
    winner: number | null;
    winningLine: Array<number> | null;
    nextPiece: BoardPiece;
};

export type SanitizedPlayer = {
    id: number;
    username: string;
    playingFor: BoardPiece;
    score: number;
}

export enum BoardPiece {
    DRAW,
    X,
    O
}