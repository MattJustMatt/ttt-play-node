import SocketHandler from './SocketHandler';
import config from './config';
import { BoardPiece, Game, SanitizedPlayer } from './types/GameTypes';
import Player from './Player';
import { calculateWinner, generatePositionsFromBoards } from './utils';

const SEND_HISTORY_LENGTH = config.SEND_HISTORY_LENGTH;
let games: Array<Game> = [];
const playerHistory: Array<Player> = [];
const connectedPlayers: Map<string, Player> = new Map();

const socketHandler = new SocketHandler();

socketHandler.on('playerConnected', (playerInfo) => {
    let player = new Player(playerHistory.length, playerInfo.ipAddress);
    
    const playerLookup = getFromPlayerHistory(player);
    if (!playerLookup) {
        console.log(`[PLAYER MANAGER] Player at ${player.ipAddr} is NEW!`);
        player.playingFor = getTeamForNewPlayer();
        playerHistory.push(player);
    } else {
        player = playerLookup;
        console.log(`[PLAYER MANAGER] Player at ${player.ipAddr} is returning! Welcome!`);
    }

    connectedPlayers.set(playerInfo.socketId, player);

    // Let them know who they're playing for
    socketHandler.sendEvent(playerInfo.socketId, 'playerInformation', player.id, player.playingFor!);

    // Get them caught up on history
    const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
    socketHandler.sendEvent(playerInfo.socketId, 'history', history);
});

socketHandler.on('requestUsername', (socketId, username) => {
    
    let player = connectedPlayers.get(socketId);

    let playerWithUsername = playerHistory.find((player) => player.username === username);

    console.log(`Socket ${socketId} at IP ${player?.ipAddr} requested username ${username}`);

    // If it's not taken OR if it was taken by someone with the same IP they're allowed to have it
    if (!playerWithUsername || playerWithUsername.ipAddr === player!.ipAddr) {
        player!.username = username;
        // TODO ACK
    } else {
        // TODO NACK
    }
});

function resetInator() {
    games = games.slice(0, 0);
    addNewGame();

}

socketHandler.on('disconnect', (socketId) => {
    console.log(`${connectedPlayers.get(socketId)?.ipAddr} disconnected`);
    connectedPlayers.delete(socketId);
});

setInterval(() => {
    const playerList = Array.from(connectedPlayers.values()).slice().map((player) => {
        return {
            id: player.id,
            username: player.username,
            playingFor: player.playingFor!,
            score: player.score,
        };
    });

    socketHandler.broadcastEvent('playerList', playerList);
}, 200);

function getTeamForNewPlayer(): BoardPiece {
    const totalXs = Array.from(connectedPlayers.values()).filter((player) => player.playingFor === BoardPiece.X).length;
    const totalOs = Array.from(connectedPlayers.values()).filter((player) => player.playingFor === BoardPiece.O).length;

    console.log(`[TEAM] curX ${totalXs} curO ${totalOs}`);

    if (totalXs === totalOs) return Math.random() > 0.5 ? BoardPiece.X : BoardPiece.O;
    if (totalOs > totalXs) return BoardPiece.X;
    if (totalXs > totalOs) return BoardPiece.O;

    throw Error("Could not determine team for new player");
}

function getFromPlayerHistory(player: Player) {
    return playerHistory.find((historyPlayer) => historyPlayer.ipAddr === player.ipAddr);
}

socketHandler.on('clientUpdate', (gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => {
    try {
        if (games.length === 0) throw new Error("Received client update, but there were no games to update");
        const latestGame = games[games.length-1];
    
        if (!latestGame.boards[boardId]) throw new Error(`Requested update on game ${latestGame.id} but board ${ boardId } did not exist`);
        let boardToUpdate = latestGame.boards[boardId];
    
        if (boardToUpdate.positions[squareId] !== 0) throw new Error(`Requested update on game ${latestGame.id} board ${boardToUpdate.id} square ${ squareId } but it was already occupied (${boardToUpdate.positions[squareId]})`);
        
        // TODO: Check move validity
        boardToUpdate.positions[squareId] = updatedPiece;
        socketHandler.broadcastEvent('update', latestGame.id, boardId, squareId, updatedPiece);

        const [winner, winningLine] = calculateWinner(boardToUpdate.positions);
        if (winner) {
            boardToUpdate.winner = winner;
            boardToUpdate.winningLine = winningLine;
            socketHandler.broadcastEvent('end', games.length-1, boardToUpdate.id, winner, winningLine!);

            // Check if the entire game was won too!
            const positionsFromBoards = generatePositionsFromBoards(games[games.length-1].boards);
            const [gameWinner, gameWinningLine] = calculateWinner(positionsFromBoards);

            if (gameWinner) {
                console.log("WINNER WINNER ", gameWinningLine)
                latestGame.winner = winner;
                latestGame.winningLine = winningLine;
                socketHandler.broadcastEvent('end', games.length-1, null, gameWinner, gameWinningLine!);

                setTimeout(() => {
                    addNewGame();
                    const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
                    socketHandler.broadcastEvent('history', history);
                }, 3000);
            }
        }

        // TODO: Check game win
    } catch (err: any) { 
        console.log(`Invalid client event (${err.message})`);
    }
});

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
    });
}

addNewGame();

