import SocketHandler from './SocketHandler';
import config from './config';
import { BoardPiece, Game, SanitizedPlayer } from './types/GameTypes';
import Player from './Player';
import { calculateWinner, generatePositionsFromBoards } from './utils';

const SEND_HISTORY_LENGTH = config.SEND_HISTORY_LENGTH;
let games: Array<Game> = [];
const playerHistory: Map<string, Player> = new Map();
const connectedPlayers: Map<string, Player> = new Map();

const socketHandler = new SocketHandler();

enum ScoreValues {
    ANY_MOVE = 5,
    WIN_BOARD = 200,
    WIN_GAME = 1000,
}

socketHandler.on('playerConnected', (socketId, ipAddress, authUsername) => {
    let player: Player;
    if (authUsername && validateUsernameForPlayer(ipAddress, authUsername)) {
        player = new Player(playerHistory.size, ipAddress, authUsername);
    } else {
        player = new Player(playerHistory.size, ipAddress);
    }

    const playerFromLookup = playerHistory.get(socketId);
    if (!playerFromLookup) {
        console.log(`[NEW PLAYER CONNECTED] ${socketId}@${ipAddress}`);
        player.playingFor = getTeamForNewPlayer();
        playerHistory.set(socketId, player);
    } else {
        player = playerFromLookup;
        console.log(`[RETURNING PLAYER CONNECTED] ${socketId}@${ipAddress}`);
    }

    connectedPlayers.set(socketId, player);

    // Let them know who they're playing for
    socketHandler.sendEvent(socketId, 'playerInformation', player.id, player.username, player.playingFor!);

    // Get them caught up on history
    const history = games.slice(Math.max(games.length-SEND_HISTORY_LENGTH, 0), games.length);
    socketHandler.sendEvent(socketId, 'history', history);
});

socketHandler.on('requestUsername', (socketId, username, respond) => {
    let player = connectedPlayers.get(socketId);

    console.log(`Socket ${socketId} at IP ${player?.ipAddr} requested username ${username}`);

    // If it's not taken OR if it was taken by someone with the same IP they're allowed to have it
    if (validateUsernameForPlayer(player.ipAddr, username)) {
        player!.username = username;
        respond({ code: 200, message: "Success!" });
    } else {
        respond({ code: 403, message: "This username was already registered. To reclaim it, log in with your original IP address or contact support matthewsalsamendi@gmail.com" });
    }
});

function validateUsernameForPlayer(ipAddress: string, username: string) {
    let playerWithUsername = Array.from(playerHistory.values()).find((player) => player.username === username);
    
    if (!playerWithUsername || playerWithUsername.ipAddr === ipAddress) {
        return true;
    }

    return false;
}

socketHandler.on('disconnect', (socketId) => {
    console.log(`${connectedPlayers.get(socketId)?.ipAddr} disconnected`);
    connectedPlayers.delete(socketId);
});

setInterval(() => {
    const playerList = Array.from(connectedPlayers.values()).slice().sort((a, b) => b.score - a.score).map((player) => {
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
    if (totalXs === 0) return BoardPiece.X; // Needed to start fresh games

    if (totalXs === totalOs) return Math.random() > 0.5 ? BoardPiece.X : BoardPiece.O;
    if (totalOs > totalXs) return BoardPiece.X;
    if (totalXs > totalOs) return BoardPiece.O;

    throw Error("Could not determine team for new player");
}

socketHandler.on('clientUpdate', (socketId, gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => {
    try {
        const player = connectedPlayers.get(socketId)!;

        if (games.length === 0) throw new Error("Received client update, but there were no games to update");
        const latestGame = games[games.length-1];
    
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

        const [winner, winningLine] = calculateWinner(boardToUpdate.positions);
        if (winner) {
            player.score += ScoreValues.WIN_BOARD;
            boardToUpdate.winner = winner;
            boardToUpdate.winningLine = winningLine;
            socketHandler.broadcastEvent('end', games.length-1, boardToUpdate.id, winner, winningLine!);

            // Check if the entire game was won too!
            const positionsFromBoards = generatePositionsFromBoards(games[games.length-1].boards);
            const [gameWinner, gameWinningLine] = calculateWinner(positionsFromBoards);

            if (gameWinner) {
                player.score += ScoreValues.WIN_GAME;
                console.log("WINNER WINNER ", gameWinningLine)
                latestGame.winner = winner;
                latestGame.winningLine = winningLine;
                socketHandler.broadcastEvent('end', games.length-1, null, gameWinner, gameWinningLine!);

                setTimeout(() => {
                    resetGames();
                }, 10000);
            }
        }
    } catch (err: any) { 
        console.log(`Invalid client event (${err.message})`);
    }
});

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
    });
}

addNewGame();

