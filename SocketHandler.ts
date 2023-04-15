import express from "express";
import { Server } from "socket.io";
import http from 'http';
import { BoardPiece, type SanitizedPlayer, type Game } from './types/GameTypes';

import EventEmitter from 'events';

class SocketHandler extends EventEmitter {
    private io: Server<ClientToServerEvents, ServerToClientEvents>;

    constructor() {
        super();

        const app = express();
        const httpServer = http.createServer(app);
        this.io = new Server(httpServer, {
            cors: {
                origin: "*",
            }
        });

        this.io.on('connection', (socket) => {
            const socketId = socket.id;
            const ipAddress = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
            const authUsername = socket.handshake.auth.username;

            this.emit('playerConnected', socketId, ipAddress, authUsername);
            socket.on('disconnect', () => this.emit('disconnect', socketId ) );

            socket.on('clientUpdate', (...args) => this.emit('clientUpdate', socketId, ...args));
            socket.on('requestUsername', (username, callback) => this.emit('requestUsername', socketId, username, callback));
        });

        httpServer.listen(3001, () => {
            console.log(`[SOCKET HANDLER] Listening on :3001`);
        });
    }

    sendEvent<T extends keyof ServerToClientEvents>(socketId: string, event: T, ...payload: Parameters<ServerToClientEvents[T]>) {
        this.findSocketById(socketId)?.emit(event, ...payload);
    }

    private findSocketById(id: string) {
        for (const [socketId, socket] of this.io.sockets.sockets.entries()) {
            if (id === socketId) {
                return socket;
            }
        }

        return null;
    }

    broadcastEvent<T extends keyof ServerToClientEvents>(event: T, ...payload: Parameters<ServerToClientEvents[T]>) {
        this.io.emit(event, ...payload);
    }
}

export interface ServerToClientEvents {
    playerInformation: (id: number, username: string | null, playingFor: BoardPiece) => void;
    history: (gameHistory: Array<Game>) => void;
    playerList: (playerList: Array<SanitizedPlayer>) => void;
    update: (gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => void;
    end: (gameId: number, boardId: number | null, winner: BoardPiece, winningLine: Array<number> | null, winnerUsername: string) => void;
}

export interface ClientToServerEvents {
    clientUpdate: (gameId: number, boardId: number, squareId: number, updatedPiece: BoardPiece) => void;
    requestUsername: (username: string, callback: (response: { code: number, message: string}) => void) => void;
}

export default SocketHandler;