import mysql, { Connection } from 'mysql2/promise';
import { BoardPiece } from './types/GameTypes';

export class PlayerConnector {
  private connection: Connection | null;
  private host: string;
  private username: string;
  private password: string;
  private database: string;

  constructor(host: string, username: string, password: string, database: string) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.database = database;

    this.connection = null;
  }

  async connect() {
    this.connection = await mysql.createConnection({
      host     : this.host,
      user     : this.username,
      password : this.password,
      database : this.database
    });
  }

  async getPlayers() {
    if (!this.isConnected) throw new Error("Query attempted before MySQL connection was established");

    const [rows] = await this.connection!.query('SELECT * FROM users');
    return rows;
  }

  async setPlayer(userId: number, username: string, score: number, playingFor: BoardPiece, online: boolean) {
    if (!this.isConnected) throw new Error("Query attempted before MySQL connection was established");

    await this.connection!.execute('INSERT INTO users (id,username,score,playingFor,online) VALUES (?, ?, ?, ?, ?)', [ userId, username, score, playingFor, online]);
  }

  async getPlayer(queryParam: string | number) {
    if (!this.isConnected) throw new Error("Query attempted before MySQL connection was established");

    let rows;
    if (typeof queryParam === 'string') {
      [rows as Array<any>] = await this.connection!.execute('SELECT * FROM users WHERE username = ?', [queryParam]);
    } else if (typeof queryParam === 'number') {
      [rows] = await this.connection!.execute('SELECT * FROM users WHERE userId = ?', [queryParam]);
    }

    return rows;
  }

  private isConnected() {
    return this.connection !== null;
  }
}