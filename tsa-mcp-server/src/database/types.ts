/**
 * @file types.ts
 * @description Raw row types matching the SQLite schema exactly.
 * @module database
 */

/**
 * @description Raw row returned from the symbols table.
 */
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

/**
 * @description Raw row returned from the references table, optionally enriched with
 * joined caller and implementor fields.
 */
export interface ReferenceRow {
  id: number;
  source_symbol_id: number;
  target_symbol_id: number;
  ref_kind: string;
  source_line: number | null;
  confidence: string;
  /** Joined: name of the calling symbol (present on caller queries). */
  caller_name?: string;
  /** Joined: file path of the calling symbol (present on caller queries). */
  caller_file?: string;
  /** Joined: line of the call site (present on caller queries). */
  caller_line?: number;
  /** Joined: containing class of the caller (present on caller queries). */
  caller_class?: string;
  /** Joined: containing class name (present on implementor queries). */
  class_name?: string;
  /** Joined: file path of the implementor (present on implementor queries). */
  file_path?: string;
}

/**
 * @description Raw row returned from the files table.
 */
export interface FileRow {
  path: string;
  last_modified: number;
  content_hash: string;
  symbol_count: number;
  index_time_ms: number;
}
