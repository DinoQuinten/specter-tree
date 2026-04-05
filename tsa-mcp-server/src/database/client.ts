/**
 * @file client.ts
 * @description Singleton bun:sqlite Database factory with WAL mode and foreign-key enforcement.
 * @module database
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let _db: Database | null = null;

/**
 * @description Returns the singleton bun:sqlite Database instance, creating it on first call.
 * Enables WAL journal mode and foreign-key enforcement on every new connection.
 * @param dbPath - Absolute path to the SQLite database file.
 * @returns Singleton Database instance.
 * @throws {Error} - When the database file cannot be created or opened.
 */
export function getDatabase(dbPath: string): Database {
  if (_db) return _db;
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  return _db;
}
