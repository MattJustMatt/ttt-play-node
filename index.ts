import SocketHandler from './SocketHandler';
import config from './config';
import { BoardPiece, Game, SanitizedPlayer } from './types/GameTypes';
import Player from './Player';
import { searchWinner as searchWinner, generatePositionsFromBoards } from './utils';

import badWords from './somebadwords';
import { PlayerConnector } from './PlayerConnector';

const SEND_HISTORY_LENGTH = config.SEND_HISTORY_LENGTH;
const MAX_EMOTES_PER_10S = config.MAX_EMOTES_PER_10S;
const RESET_DELAY = config.RESET_DELAY;

let games: Array<Game> = [];
const playerHistory: Array<Player> = [];
const connectedPlayers: Map<string, Player> = new Map();

const socketHandler = new SocketHandler();

enum ScoreValues {
  ANY_MOVE = 5,
  WIN_BOARD = 200,
  WIN_GAME = 1000,
}

async function init() {
  const playerConnector = new PlayerConnector(config.mysql.host, config.mysql.user, config.mysql.password, config.mysql.databse);
  await playerConnector.connect();

  const playersToRestore = await playerConnector.getPlayers();
  playersToRestore.forEach((player) => {
    playerHistory.push(new Player(player.userId, player.ipAddress, player.username, player.score, player.playingFor));
  });
}

init();

socketHandler.on('playerConnected', (socketId, ipAddress, authUsername) => {
  let shellPlayer: Player;
  let playerFromLookup: Player | undefined = Array.from(playerHistory.values()).find((player) => player.username === authUsername);

  if (authUsername && ipOwnsUsername(ipAddress, authUsername)) {
    shellPlayer = new Player(playerHistory.size, ipAddress, authUsername);
  } else {
    shellPlayer = new Player(playerHistory.size, ipAddress);

    // Invalidate their access if the username wasn't allowed (IP mismatch);
    playerFromLookup = undefined;
  }

  if (!playerFromLookup) {
    shellPlayer.playingFor = getTeamForNewPlayer();
    console.log(`[NEW PLAYER CONNECTED] ${socketId}@${ipAddress} assigned piece ${shellPlayer.playingFor}`);
    playerHistory.set(socketId, shellPlayer);
  } else {
    shellPlayer = playerFromLookup;
    console.log(`[RETURNING PLAYER CONNECTED] ${socketId}@${ipAddress}`);
  }

  connectedPlayers.set(socketId, shellPlayer);

  // Let them know who they're playing for
  socketHandler.sendEvent(socketId, 'playerInformation', shellPlayer.id, shellPlayer.username, shellPlayer.playingFor!, true);

  // Get them caught up on history
  const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
  socketHandler.sendEvent(socketId, 'history', history);

  broadcastPlayerList();
});

socketHandler.on('requestUsername', (socketId: string, username: string, respond: (response: { code: number, message: string}) => void) => {
  let player = connectedPlayers.get(socketId)!;
  username = username.trim();

  console.log(`Socket ${socketId} at IP ${player?.ipAddr} requested username ${username}`);

  if (!ipOwnsUsername(player.ipAddr, username)) {
    respond({ code: 403, message: "This username was already registered. To reclaim it, log in with your original IP address or contact support matthewsalsamendi@gmail.com" });
    return;
  }

  for (let i = 0; i < badWords.length; i++) {
    if (username.toLowerCase().includes(badWords[i])) {
      respond({ code: 418, message: "There's something strange about your username... try a different one!"})
      return;
    }
  }

  player.username = username;
  respond({ code: 200, message: "Success!" });
  broadcastPlayerList();
});

socketHandler.on('disconnect', (socketId) => {
  console.log(`${connectedPlayers.get(socketId)?.ipAddr} disconnected`);
  connectedPlayers.delete(socketId);
  broadcastPlayerList();
});

function getSanitizedPlayerList() {
  return Array.from(playerHistory.values()).filter(player => player.username !== null).sort((a, b) => b.score - a.score).map((player) => {
    return {
      id: player.id,
      username: player.username,
      playingFor: player.playingFor!,
      score: player.score,
      online: Array.from(connectedPlayers.values()).includes(player)
    };
  });
}

function broadcastPlayerList() {
  socketHandler.broadcastEvent('playerList', getSanitizedPlayerList());
}

socketHandler.on('emote', (socketId: string, emoteSlug: string) => {
  const player = connectedPlayers.get(socketId)!;

  if (player.emotesPerLargeInterval < MAX_EMOTES_PER_10S) {
    player.emotesPerLargeInterval++;
  
      socketHandler.broadcastEvent('emote', player.id!, emoteSlug);
  } else {
    socketHandler.sendEvent(socketId, 'playerInformation', player.id, player.username, player.playingFor!, false)
  }
});

socketHandler.on('clientUpdate', (socketId, gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => {
  try {
    const player = connectedPlayers.get(socketId)!;

    if (games.length === 0) throw new Error("Received client update, but there were no games to update");
    const latestGame = games[games.length-1];

    if (latestGame.winner !== null) throw new Error("Move attempted on ended game");
    if (!latestGame.boards[boardId]) throw new Error(`Requested update on game ${latestGame.id} but board ${ boardId } did not exist`);
    let boardToUpdate = latestGame.boards[boardId];

    if (boardToUpdate.positions[squareId] !== 0) throw new Error(`Requested update on game ${latestGame.id} board ${boardToUpdate.id} square ${ squareId } but it was already occupied (${boardToUpdate.positions[squareId]})`);
    if (updatedPiece !== latestGame.nextPiece) throw new Error(`Invalid board piece requested. ${latestGame.nextPiece} should've been the next piece but ${updatedPiece} was requested`);
    if (player.playingFor !== updatedPiece) throw new Error(`Player ${player.ipAddr}@${socketId} sent update for piece ${updatedPiece} that wasn't theres! ${player.playingFor}`);
    
    // -- From here on out the move is assumed to be valid -- //
    boardToUpdate.positions[squareId] = updatedPiece;
    latestGame.nextPiece = latestGame.nextPiece === BoardPiece.X ? BoardPiece.O : BoardPiece.X;

    player.score += ScoreValues.ANY_MOVE;
    socketHandler.broadcastEvent('update', latestGame.id, boardId, squareId, updatedPiece);

    const [winner, winningLine] = searchWinner(boardToUpdate.positions);
    if (winner !== null) {
      if (winner !== BoardPiece.DRAW) {
        player.score += ScoreValues.WIN_BOARD;
      }
      
      boardToUpdate.winner = winner;
      boardToUpdate.winningLine = winningLine;
      socketHandler.broadcastEvent('end', games.length-1, boardToUpdate.id, winner, winningLine, connectedPlayers.get(socketId)?.username!);

      // Check if the entire game was won too!
      const positionsFromBoards = generatePositionsFromBoards(games[games.length-1].boards);
      const [gameWinner, gameWinningLine] = searchWinner(positionsFromBoards);

      if (gameWinner !== null) {
        if (gameWinner !== BoardPiece.DRAW) {
          console.log("GAME DRAW! ", gameWinningLine)
          player.score += ScoreValues.WIN_GAME;
        } else {
          console.log("WINNER WINNER ", gameWinningLine)
        }
        
        latestGame.winner = winner;
        latestGame.winningLine = winningLine;
        latestGame.winnerUsername = connectedPlayers.get(socketId)?.username!;
        socketHandler.broadcastEvent('end', games.length-1, null, gameWinner, gameWinningLine, connectedPlayers.get(socketId)?.username!);

        setTimeout(() => {
          resetGames();
        }, RESET_DELAY);
      }
    }

    broadcastPlayerList();
  } catch (err: any) { 
    console.log(`Invalid client event (${err.message})`);
  }
});

function ipOwnsUsername(ipAddress: string, username: string) {
  let playerWithUsername = Array.from(playerHistory.values()).find((player) => player.username === username);
  
  if (!playerWithUsername || playerWithUsername.ipAddr === ipAddress) {
    return true;
  }

  return false;
}

function getTeamForNewPlayer(): BoardPiece {
  const totalXs = Array.from(connectedPlayers.values()).filter((player) => player.playingFor === BoardPiece.X).length;
  const totalOs = Array.from(connectedPlayers.values()).filter((player) => player.playingFor === BoardPiece.O).length;

  console.log(`[TEAM] curX ${totalXs} curO ${totalOs}`);
  if (totalXs === totalOs) return games[games.length-1].nextPiece;
  if (totalOs > totalXs) return BoardPiece.X;
  if (totalXs > totalOs) return BoardPiece.O;

  throw Error("Could not determine team for new player");
}

function resetGames() {
  console.log("RESETTING GAMES!");
  games = [];
  addNewGame();

  // Get them caught up on history
  const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
  socketHandler.broadcastEvent('history', history);
}

function addNewGame() {
  const freshBoards = Array.from({length: 9}).map((_, index) => {
    return {
      id: index,
      positions: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      winner: null,
      winningLine: null
    };
  });

  games.push({
    id: games.length,
    boards: freshBoards,
    winner: null,
    winningLine: null,
    nextPiece: BoardPiece.X,
    winnerUsername: null,
  });
}

addNewGame();
