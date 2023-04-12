import { Board, BoardPiece } from "./types/GameTypes";

export const calculateWinner = (positions: Array<BoardPiece>): [BoardPiece | null, Array<number> | null] => {
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
    
    let occupied = 0;
    for (let i = 0; i < lines.length; i++) {
        if (positions[i] !== 0) occupied++;
        if (occupied === positions.length) return [0, null]; // Draw case

        const [a, b, c] = lines[i];
        if (positions[a] && positions[a] === positions[b] && positions[a] === positions[c]) {
            return [positions[a] as BoardPiece, lines[i]];
        }
    }

    return [null, null];
}

export const generatePositionsFromBoards = (boards: Array<Board>): Array<number> => {
    const positions = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    for (let i = 0; i < positions.length; i++) {
        positions[i] = boards[i].winner !== null ? boards[i].winner! : BoardPiece.DRAW;
    }
    
    return positions;
}
