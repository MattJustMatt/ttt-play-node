import { BoardPiece } from "./types/GameTypes";

class Player {
    id: number;
    ipAddr: string;
    username: string | null;
    playingFor: BoardPiece | null;
    score: number;

    constructor(id: number, ipAddr: string) {
        this.id = id;
        this.ipAddr = ipAddr;

        this.username = null;
        this.playingFor = null;

        this.score = 0;
    }
}

export default Player;