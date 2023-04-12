import { BoardPiece } from "./types/GameTypes";

class Player {
    id: number;
    ipAddr: string;
    username: string;
    playingFor: BoardPiece | null;
    score: number;

    constructor(id: number, ipAddr: string) {
        this.id = id;
        this.ipAddr = ipAddr;

        this.username = "Anonymous";
        this.playingFor = null;

        this.score = Number.parseInt((Math.random() * 134).toFixed(0));
    }
}

export default Player;