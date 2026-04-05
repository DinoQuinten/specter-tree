/**
 * @file common.ts
 * @description Shared types used across all services and tools.
 * @module types
 */

/**
 * @description All valid symbol kinds extracted from the TypeScript AST.
 */
export type SymbolKind =
  | 'class' | 'interface' | 'enum' | 'type_alias' | 'function'
  | 'method' | 'property' | 'constructor' | 'getter' | 'setter'
  | 'enum_member' | 'variable';

/**
 * @description All valid reference and edge kinds stored in the call graph.
 */
export type RefKind = 'calls' | 'imports' | 'extends' | 'implements' | 'type_ref' | 'decorator';

/**
 * @description Static analysis confidence level for call graph edges.
 */
export type Confidence = 'direct' | 'inferred' | 'weak';

/**
 * @description HTTP methods supported by framework route resolvers.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * @description A symbol extracted from the TypeScript AST.
 * `_parentName` is internal-only for two-pass DB insert and is stripped before storage.
 */
export interface TsaSymbol {
  /** Database row ID; absent before insert. */
  id?: number;
  /** Declared symbol name. */
  name: string;
  /** Symbol kind as determined by AST node type. */
  kind: SymbolKind;
  /** Absolute path of the file that declares this symbol. */
  file_path: string;
  /** One-based line number of the declaration. */
  line: number;
  /** Zero-based column offset of the declaration. */
  column: number;
  /** One-based line number of the closing token, or null for single-line symbols. */
  end_line: number | null;
  /** Row ID of the enclosing symbol, or null for top-level declarations. */
  parent_id: number | null;
  /** Full type signature string, or null when not available. */
  signature: string | null;
  /** Space-separated TypeScript modifiers (e.g. `public readonly`). */
  modifiers: string;
  /** Return type annotation string, or null when not available. */
  return_type: string | null;
  /** Serialised parameter list, or null when not applicable. */
  params: string | null;
  /** Extracted JSDoc comment, or null when absent. */
  doc_comment: string | null;
  /** Internal: parent class name for two-pass ID resolution. Not stored in DB. */
  _parentName?: string;
}

/**
 * @description A directed edge in the call, import, or inheritance graph.
 */
export interface TsaReference {
  /** Row ID of the symbol that is the source of this edge. */
  source_symbol_id: number;
  /** Row ID of the symbol that is the target of this edge. */
  target_symbol_id: number;
  /** Type of relationship this edge represents. */
  ref_kind: RefKind;
  /** Source line where the reference occurs, or null when unavailable. */
  source_line: number | null;
  /** Confidence level of the static analysis that produced this edge. */
  confidence: Confidence;
}

/**
 * @description File record stored in the files table for incremental indexing.
 */
export interface FileRecord {
  /** Absolute file path. */
  path: string;
  /** File modification timestamp (Unix ms). */
  last_modified: number;
  /** SHA-256 content hash used to skip unchanged files. */
  content_hash: string;
  /** Number of symbols indexed from this file. */
  symbol_count: number;
  /** Wall-clock time taken to index this file in milliseconds. */
  index_time_ms: number;
}

/**
 * @description A single middleware entry returned by the trace_middleware tool.
 */
export interface MiddlewareTrace {
  /** Display name of the middleware function. */
  name: string;
  /** Absolute path of the file that declares the middleware. */
  file_path: string;
  /** One-based line number of the middleware declaration. */
  line: number;
  /** Execution order index in the middleware chain. */
  order: number;
}

/**
 * @description Route configuration returned by the get_route_config tool.
 */
export interface RouteConfig {
  /** Handler function or component name. */
  handler: string;
  /** Absolute path of the file that declares the handler. */
  file_path: string;
  /** Guard or auth middleware names applied to this route. */
  guards: string[];
  /** Redirect targets configured for this route. */
  redirects: string[];
}

/**
 * @description Metadata block included in every tool response.
 */
export interface ToolMeta {
  /** Number of records in the response. */
  count: number;
  /** Wall-clock query time in milliseconds. */
  query_ms: number;
  /** UUID that correlates a request across log entries. */
  correlationId: string;
}

/**
 * @description Successful tool response envelope wrapping a typed result array.
 */
export interface ToolResult<T> {
  /** Result records returned by the tool. */
  results: T[];
  /** Non-fatal warnings the caller should surface. */
  _warnings?: string[];
  /** Standard tool response metadata. */
  _meta: ToolMeta;
}

/**
 * @description Error response envelope returned when a tool call fails.
 */
export interface ToolError {
  success: false;
  /** Structured error details. */
  error: {
    /** Machine-readable error code. */
    code: string;
    /** Human-readable error description. */
    message: string;
    /** Additional diagnostic context. */
    context?: Record<string, unknown>;
  };
  /** Partial metadata available even on failure. */
  _meta: { query_ms: number };
}

/**
 * @description A named reference before database ID resolution.
 * When `sourceName` equals `'<file>'`, any symbol from `sourceFile` is used as the source anchor.
 */
export interface NamedRef {
  /** Name of the source symbol, or `'<file>'` to anchor on the file. */
  sourceName: string;
  /** Absolute path of the file that contains the source symbol. */
  sourceFile: string;
  /** Optional parent class name for source method disambiguation. */
  sourceParentName?: string | null;
  /** Name of the target symbol. */
  targetName: string;
  /** Absolute path of the file that contains the target symbol, or null when unknown. */
  targetFile: string | null;
  /** Optional parent class name for target method disambiguation. */
  targetParentName?: string | null;
  /** Kind of relationship this named reference represents. */
  ref_kind: RefKind;
  /** Source line of the reference, or null when unavailable. */
  source_line: number | null;
  /** Confidence level of the static analysis that produced this reference. */
  confidence: 'direct' | 'inferred' | 'weak';
}
