/**
 * @file client.ts
 * @description bun:sqlite Database factory with WAL mode and foreign-key enforcement.
 * @module database
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @description Creates a bun:sqlite Database instance for the given path and enables
 * WAL journal mode plus foreign-key enforcement.
 * @param dbPath - Absolute path to the SQLite database file.
 * @returns Database instance.
 * @throws {Error} - When the database file cannot be created or opened.
 */
export function getDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}
