/**
 * @module database/types
 * @description Raw row types matching the SQLite schema exactly.
 */

/** Raw row from the symbols table */
export interface SymbolRow {
  id: number;
  name: string;
  kind: string;
  file_path: string;
  line: number;
  column: number;
  end_line: number | null;
  parent_id: number | null;
  signature: string | null;
  modifiers: string;
  return_type: string | null;
  params: string | null;
  doc_comment: string | null;
}

/** Raw row from the references table (may include joined fields) */
export interface ReferenceRow {
  id: number;
  source_symbol_id: number;
  target_symbol_id: number;
  ref_kind: string;
  source_line: number | null;
  confidence: string;
  caller_name?: string;
  caller_file?: string;
  caller_line?: number;
  caller_class?: string;
  class_name?: string;
  file_path?: string;
}

/** Raw row from the files table */
export interface FileRow {
  path: string;
  last_modified: number;
  content_hash: string;
  symbol_count: number;
  index_time_ms: number;
}
