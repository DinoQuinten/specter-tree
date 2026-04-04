import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let _db: Database | null = null;

/**
 * Get or create the singleton bun:sqlite Database instance.
 * @param dbPath Absolute path to the SQLite database file
 * @returns Singleton Database instance
 */
export function getDatabase(dbPath: string): Database {
  if (_db) return _db;
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  return _db;
}
