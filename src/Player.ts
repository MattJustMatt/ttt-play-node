import { BoardPiece } from "./types/GameTypes";

class Player {
  uuid: string;
  ipAddress: string;
  username: string | null;
  playingFor: BoardPiece;
  score: number;
  emotesPerInterval: number;

  constructor(uuid: string, ipAddress: string, score: number, playingFor: BoardPiece, username: string | null) {
    this.uuid = uuid;
    this.ipAddress = ipAddress;
    this.score = score;
    this.playingFor = playingFor;
    this.username = username;
    
    this.emotesPerInterval = 0;
    // Ideally this interval would be based on the timing that they send an emote, not a fixed starting point.
    setInterval(() => {
      this.emotesPerInterval = 0;
    }, 10000);
  }
}

export default Player;