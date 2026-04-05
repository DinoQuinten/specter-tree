import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @description Full DDL string for all TSA tables and indexes.
 * Loaded from 0001_initial.sql at module load time.
 */
export const SCHEMA_DDL: string = readFileSync(
  join(__dirname, 'migrations', '0001_initial.sql'),
  'utf-8'
);
