import { BoardPiece } from "./types/GameTypes";

class Player {
  id: number;
  ipAddr: string;
  username: string | null;
  playingFor: BoardPiece | null;
  score: number;
  emotesPerLargeInterval: number;

  constructor(id: number, ipAddr: string, username?: string) {
    this.id = id;
    this.ipAddr = ipAddr;

    this.username = username || null;
    this.playingFor = null;

    this.score = 0;
    
    this.emotesPerLargeInterval = 0;
    // Ideally this interval would be based on the timing that they send an emote, not a fixed starting point.
    setInterval(() => {
      this.emotesPerLargeInterval = 0;
    }, 10000);
  }
}

export default Player;