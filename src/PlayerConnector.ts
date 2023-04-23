import mysql, { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { BoardPiece } from './types/GameTypes';
import { Pool } from 'mysql2/promise';

export class PlayerConnector {
  private connection: Pool | null;
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
    this.connection = mysql.createPool({
      host: this.host,
      user: this.username,
      password: this.password,
      database: this.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  private throwIfNotConnected() {
    if (!this.isConnected) throw new Error("Query attempted before MySQL connection was established");
  }

  private isConnected() {
    return this.connection !== undefined;
  }

  async getPlayers(): Promise<UserStub[]> {
    this.throwIfNotConnected();

    const [rows] = await this.connection!.query('SELECT BIN_TO_UUID(id) AS uuid, username, score, ipAddress, playingFor FROM users');
    return rows as UserStub[];
  }

  async updatePlayerByUuid(uuid: string, username: string, ipAddress: string, score: number, playingFor: BoardPiece, online: boolean) {
    this.throwIfNotConnected();

    const result = await this.connection!.execute<ResultSetHeader>('UPDATE users SET username=?, ipAddress=?, score=?, playingFor=?, online=? WHERE id=UUID_TO_BIN(?)', [ username, ipAddress, score, playingFor, online, uuid]);
    if (result[0].affectedRows === 0) throw new Error(`DB reported no players matched uuid: ${uuid}`);
  }

  async updateScore(uuid: string, newScore: number) {
    this.throwIfNotConnected();

    const result = await this.connection!.execute<ResultSetHeader>('UPDATE users SET score=? WHERE id=UUID_TO_BIN(?)', [ newScore, uuid]);
    if (result[0].affectedRows === 0) throw new Error(`DB reported no players matched uuid: ${uuid}`);
  }

  async insertPlayer(uuid: string, username: string, ipAddress: string, score: number, playingFor: BoardPiece, online: boolean) {
    this.throwIfNotConnected();

    await this.connection!.execute('INSERT INTO users (id, username, ipAddress, score, playingFor, online) VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?)', [ uuid, username, ipAddress, score, playingFor, online]);
  }

  async getPlayer(queryParam: string | number): Promise<UserStub> {
    this.throwIfNotConnected();

    let rows: Array<RowDataPacket> = [];
    if (typeof queryParam === 'string') {
      [rows] = await this.connection!.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS uuid, username, score, ipAddress, playingFor FROM users WHERE username = ?', [queryParam]);
    } else if (typeof queryParam === 'number') {
      [rows] = await this.connection!.execute<RowDataPacket[]>('SELECT BIN_TO_UUID(id) AS uuid, username, score, ipAddress, playingFor FROM users WHERE userId = ?', [queryParam]);
    }

    if (rows.length > 1) {
      throw new Error("Query matched more than one player");
    }

    return rows[0] as UserStub;
  }
}

type UserStub = {
  uuid: string;
  username: string;
  score: number;
  playingFor: number;
  online: boolean;
  ipAddress: string;
};