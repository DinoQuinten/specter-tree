/**
 * @module common
 * @description Shared types used across all services and tools.
 */

/** All valid symbol kinds extracted from TypeScript AST */
export type SymbolKind =
  | 'class' | 'interface' | 'enum' | 'type_alias' | 'function'
  | 'method' | 'property' | 'constructor' | 'getter' | 'setter'
  | 'enum_member' | 'variable';

/** All valid reference/edge kinds in the call graph */
export type RefKind = 'calls' | 'imports' | 'extends' | 'implements' | 'type_ref' | 'decorator';

/** Static analysis confidence level for call graph edges */
export type Confidence = 'direct' | 'inferred' | 'weak';

/** HTTP methods supported by framework route resolvers */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * A symbol extracted from the TypeScript AST.
 * _parentName is internal-only for two-pass DB insert — stripped before storage.
 */
export interface TsaSymbol {
  id?: number;
  name: string;
  kind: SymbolKind;
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
  /** Internal: parent class name for two-pass ID resolution. Not stored in DB. */
  _parentName?: string;
}

/** A directed edge in the call/import/inheritance graph */
export interface TsaReference {
  source_symbol_id: number;
  target_symbol_id: number;
  ref_kind: RefKind;
  source_line: number | null;
  confidence: Confidence;
}

/** File record stored in the files table for incremental indexing */
export interface FileRecord {
  path: string;
  last_modified: number;
  content_hash: string;
  symbol_count: number;
  index_time_ms: number;
}

/** A single middleware entry returned by trace_middleware */
export interface MiddlewareTrace {
  name: string;
  file_path: string;
  line: number;
  order: number;
}

/** Route configuration returned by get_route_config */
export interface RouteConfig {
  handler: string;
  file_path: string;
  guards: string[];
  redirects: string[];
}

/** Metadata included in every tool response */
export interface ToolMeta {
  count: number;
  query_ms: number;
  correlationId: string;
}

/** Successful tool response envelope */
export interface ToolResult<T> {
  results: T[];
  _warnings?: string[];
  _meta: ToolMeta;
}

/** Error tool response envelope */
export interface ToolError {
  success: false;
  error: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
  };
  _meta: { query_ms: number };
}

/**
 * A named reference before DB ID resolution.
 * sourceName='<file>' means: use any symbol from sourceFile as the source anchor.
 */
export interface NamedRef {
  sourceName: string;
  sourceFile: string;
  targetName: string;
  targetFile: string | null;
  ref_kind: 'calls' | 'imports' | 'extends' | 'implements';
  source_line: number | null;
  confidence: 'direct' | 'inferred' | 'weak';
}
