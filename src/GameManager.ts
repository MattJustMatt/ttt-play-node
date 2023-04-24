import SocketHandler from './SocketHandler';
import config from '../config';
import { BoardPiece, Game, SanitizedPlayer } from './types/GameTypes';
import Player from './Player';
import { searchWinner as searchWinner, generatePositionsFromBoards } from './utils';
import { v1 as uuidv1 } from 'uuid';

import badWords from '../somebadwords';
import { PlayerConnector } from './PlayerConnector';

const SEND_HISTORY_LENGTH = config.SEND_HISTORY_LENGTH;
const MAX_EMOTES_PER_10S = config.MAX_EMOTES_PER_10S;
const RESET_DELAY = config.RESET_DELAY;

let games: Array<Game> = [];
const playerHistory: Array<Player> = [];
const connectedPlayers: Map<string, Player> = new Map();

enum ScoreValues {
  ANY_MOVE = 5,
  WIN_BOARD = 200,
  WIN_GAME = 1000,
}

export async function init() {
  addNewGame();
  const playerConnector = new PlayerConnector(config.mysql.host, config.mysql.user, config.mysql.password, config.mysql.databse);
  await playerConnector.connect();

  // Restore player history from DB
  const playersToRestore = await playerConnector.getPlayers();
  playersToRestore.forEach((player) => {
    playerHistory.push(new Player(player.uuid, player.ipAddress, player.score, player.playingFor, player.username));
  });

  const socketHandler = new SocketHandler();

  socketHandler.on('playerConnected', (socketId: string, connectingIP: string, authUsername: string | null) => {
    let playerFromLookup: Player | undefined = Array.from(playerHistory.values()).find((player) => player.username === authUsername);

    if (authUsername && (!ipOwnsUsername(connectingIP, authUsername) || playerFromLookup === undefined)) {
      // Invalidate their access
      playerFromLookup = undefined;
      authUsername = null;
    }
  
    let connectingPlayer: Player;
    if (playerFromLookup) {
        connectingPlayer = playerFromLookup;
        console.log(`[PLAYER MANAGER] Player (${connectingPlayer.username}@${connectingPlayer.ipAddress}) is returning!`);
    } else {
      connectingPlayer = new Player(uuidv1(), connectingIP, 0, getBoardPieceForNewPlayer(), authUsername);
      console.log(`[PLAYER MANAGER] ${socketId}@${connectingIP} is NEW! Assigned piece ${connectingPlayer.playingFor === BoardPiece.X ? 'X' : 'O'}`);
      // Player won't be written to the DB/playerHistory till they request a username
    }
  
    connectedPlayers.set(socketId, connectingPlayer);
  
    // Send their initial player information. Username can be null here if a lookup wasn't successful, in which case the client will be asked to set one
    socketHandler.sendEvent(socketId, 'playerInformation', connectingPlayer.uuid, connectingPlayer.username, connectingPlayer.playingFor);
  
    // Get them caught up on history
    const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
    socketHandler.sendEvent(socketId, 'history', history);
  
    broadcastPlayerList();
  });

  socketHandler.on('requestUsername', (socketId: string, requestedUsername: string, respond: (response: { code: number, message: string}) => void) => {
    const userFromPlayerHistory = Array.from(playerHistory.values()).find((player) => player.username?.toLowerCase() === requestedUsername.toLowerCase())
    let connectedPlayer = connectedPlayers.get(socketId)!;

    requestedUsername = requestedUsername.trim();
    const priorUsername = connectedPlayer.username || null;
  
    console.log(`[AUTH] Username ${priorUsername} at IP ${connectedPlayer.ipAddress} requested username ${requestedUsername}`);
  
    if (userFromPlayerHistory !== undefined && !ipOwnsUsername(connectedPlayer.ipAddress, requestedUsername)) {
      console.log("[AUTH] Not owned rejecting username");
      respond({ code: 403, message: `This username was already registered. To reclaim it, log in with your original IP address or contact support (${config.SUPPORT_EMAIL})` });
      return;
    }
  
    for (let i = 0; i < badWords.length; i++) {
      if (requestedUsername.toLowerCase().includes(badWords[i])) {
        console.log("[AUTH] Profanity rejecting username");
        respond({ code: 418, message: "There's something strange about your username... try a different one!"})
        return;
      }
    }
  
    if (userFromPlayerHistory === undefined) {
      if (priorUsername === null) {
        // User creation flow (no existing username matches the requested one too)
        console.log(`[AUTH] This looks like a fresh request from a newbie for ${requestedUsername}. Allowed, no playerHistory matches.`)

        connectedPlayer.username = requestedUsername;
        playerHistory.push(connectedPlayer);
        playerConnector.insertPlayer(connectedPlayer.uuid, connectedPlayer.username, connectedPlayer.ipAddress, connectedPlayer.score, connectedPlayer.playingFor, true);
      } else {
        // Renaming flow (no existing username matches the requested one too)
        console.log(`[AUTH] Renaming ${connectedPlayer.username} to ${requestedUsername}`);

        connectedPlayer.username = requestedUsername;
        playerConnector.updatePlayerByUuid(connectedPlayer.uuid, connectedPlayer.username, connectedPlayer.ipAddress, connectedPlayer.score, connectedPlayer.playingFor, true);
      }
    } else {
      // Taking control of existing user flow
      console.log(`[AUTH] Renaming/authorizing ${connectedPlayer.username} to EXISTING ACCOUNT ${requestedUsername} (UUID: ${userFromPlayerHistory.uuid})`)

      connectedPlayers.set(socketId, userFromPlayerHistory);
      socketHandler.sendEvent(socketId, 'playerInformation', userFromPlayerHistory.uuid, userFromPlayerHistory.username, userFromPlayerHistory.playingFor);

      // Just for online status
      playerConnector.updatePlayerByUuid(userFromPlayerHistory.uuid, requestedUsername, userFromPlayerHistory.ipAddress, userFromPlayerHistory.score, userFromPlayerHistory.playingFor, true);
    }
    
    respond({ code: 200, message: "Success!" });
    broadcastPlayerList();
  });
  
  socketHandler.on('disconnect', (socketId) => {
    const player = connectedPlayers.get(socketId);

    console.log(`[PLAYER MANAGER] Player (${player?.username}@${player?.ipAddress}) disconnected (socket ID: ${socketId})`);
    connectedPlayers.delete(socketId);
    broadcastPlayerList();
  });
  
  socketHandler.on('emote', (socketId: string, emoteSlug: string) => {
    const player = connectedPlayers.get(socketId)!;
    if (player.emotesPerInterval > MAX_EMOTES_PER_10S) return;
  
    player.emotesPerInterval++;
    socketHandler.broadcastEvent('emote', player.uuid!, emoteSlug);
  });
  
  socketHandler.on('clientUpdate', (socketId, gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => {
    try {
      const player = connectedPlayers.get(socketId)!;
      if (player.username === undefined) throw new Error(`Player socket ${socketId} with iP ${player.ipAddress} sent an update without a username (bot?)`);
  
      if (games.length === 0) throw new Error("Received client update, but there were no games to update");
      const latestGame = games[games.length-1];
  
      if (latestGame.winner !== null) throw new Error("Move attempted on ended game");
      if (!latestGame.boards[boardId]) throw new Error(`Requested update on game ${latestGame.id} but board ${ boardId } did not exist`);
      let boardToUpdate = latestGame.boards[boardId];
  
      if (boardToUpdate.positions[squareId] !== 0) throw new Error(`Requested update on game ${latestGame.id} board ${boardToUpdate.id} square ${ squareId } but it was already occupied (${boardToUpdate.positions[squareId]})`);
      if (updatedPiece !== latestGame.nextPiece) throw new Error(`Invalid board piece requested. ${latestGame.nextPiece} should've been the next piece but ${updatedPiece} was requested`);
      if (player.playingFor !== updatedPiece) throw new Error(`Player ${player.ipAddress}@${socketId} sent update for piece ${updatedPiece} that wasn't theres! ${player.playingFor}`);
      
      // -- From here on out the move is assumed to be valid -- //
      boardToUpdate.positions[squareId] = updatedPiece;
      latestGame.nextPiece = latestGame.nextPiece === BoardPiece.X ? BoardPiece.O : BoardPiece.X;
  
      player.score += ScoreValues.ANY_MOVE;
      playerConnector.updateScore(player.uuid, player.score);
      socketHandler.broadcastEvent('update', latestGame.id, boardId, squareId, updatedPiece, player.username!);
  
      const [winner, winningLine] = searchWinner(boardToUpdate.positions);
      if (winner !== null) {
        if (winner !== BoardPiece.DRAW) {
          player.score += ScoreValues.WIN_BOARD;
          playerConnector.updateScore(player.uuid, player.score);
        }
        
        // Send the single board win event
        boardToUpdate.winner = winner;
        boardToUpdate.winningLine = winningLine;
        socketHandler.broadcastEvent('end', games.length-1, boardToUpdate.id, winner, winningLine, connectedPlayers.get(socketId)?.username!);
  
        // Check if the entire game was won too!
        const positionsFromBoards = generatePositionsFromBoards(games[games.length-1].boards);
        const [gameWinner, gameWinningLine] = searchWinner(positionsFromBoards);
  
        if (gameWinner !== null) {
          if (gameWinner !== BoardPiece.DRAW) {
            console.log("WINNER WINNER ", gameWinningLine)

            player.score += ScoreValues.WIN_GAME;
            playerConnector.updateScore(player.uuid, player.score);
          } else {
            console.log("GAME DRAW! ", gameWinningLine)
          }
          
          latestGame.winner = winner;
          latestGame.winningLine = winningLine;
          latestGame.winnerUsername = connectedPlayers.get(socketId)?.username!;
          socketHandler.broadcastEvent('end', games.length-1, null, gameWinner, gameWinningLine, connectedPlayers.get(socketId)?.username!);
  
          setTimeout(() => {
            resetGames();
            broadcastHistory();
          }, RESET_DELAY);
        }
      }
  
      broadcastPlayerList();
    } catch (err: any) { 
      console.log(`Invalid client event (${err.message})`);
    }
  });

  const ipOwnsUsername = (requesterIpAddress: string, username: string) => {
    let playerWithUsername = Array.from(playerHistory.values()).find((player) => player.username?.toLowerCase() === username.toLowerCase());
    if (!playerWithUsername) {
      console.log(`[AUTH] Player with IP ${requesterIpAddress} sent header requesting username ${username} but they were not found in local player array`);
      return false;
    }
    
    // NOTE: Old entries in the database did not have an IP Address. We authenticate these users and set a new IP in the DB for them. This line will be obsolete once all are set. 
    if (playerWithUsername.ipAddress === null) {
      console.log(`[AUTH] user at IP ${requesterIpAddress} requested ${username} and was found but no IP Address was available to compare with (legacy acct). OK`)
      playerWithUsername.ipAddress = requesterIpAddress;
      playerConnector.updatePlayerByUuid(playerWithUsername.uuid, playerWithUsername.username!, playerWithUsername.ipAddress, playerWithUsername.score, playerWithUsername.playingFor, true);
      return true;
    }
  
    if (playerWithUsername.ipAddress === requesterIpAddress) return true;
  
    return false;
  }
  
  const broadcastPlayerList = () => {
    socketHandler.broadcastEvent('playerList', getSanitizedPlayerList());
  }

  const broadcastHistory = () => {
    const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
    socketHandler.broadcastEvent('history', history);
  }
}

function getSanitizedPlayerList() {
  return Array.from(playerHistory.values()).sort((a, b) => b.score - a.score).map((player) => {
    return {
      uuid: player.uuid,
      username: player.username,
      playingFor: player.playingFor!,
      score: player.score,
      online: Array.from(connectedPlayers.values()).includes(player)
    };
  });
}

function getBoardPieceForNewPlayer(): BoardPiece {
  const totalXs = Array.from(connectedPlayers.values()).filter((player) => player.playingFor === BoardPiece.X).length;
  const totalOs = Array.from(connectedPlayers.values()).filter((player) => player.playingFor === BoardPiece.O).length;

  console.log(`[TEAM BALANCE] Xs: ${totalXs} Os: ${totalOs}`);
  if (totalXs === totalOs) return games[games.length-1].nextPiece;
  if (totalOs > totalXs) return BoardPiece.X;
  if (totalXs > totalOs) return BoardPiece.O;

  throw Error("Could not determine team for new player");
}

function resetGames() {
  console.log("RESETTING GAMES!");
  games = [];
  addNewGame();
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
