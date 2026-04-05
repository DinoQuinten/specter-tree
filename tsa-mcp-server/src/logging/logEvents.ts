/**
 * @file logEvents.ts
 * @description Centralised log event name constants. All structured log calls must reference
 * a value from this enum instead of using ad-hoc strings.
 * @module logging
 */

/**
 * @description All log event name constants used for structured log entries.
 * Never use ad-hoc strings for log events — always reference a member of this enum.
 */
export enum LogEvents {
  DB_INITIALIZED        = 'db.initialized',
  DB_MIGRATION_RAN      = 'db.migration_ran',
  SYMBOLS_INSERTED      = 'db.symbols_inserted',
  REFS_INSERTED         = 'db.refs_inserted',
  FILE_SYMBOLS_DELETED  = 'db.file_symbols_deleted',
  INDEXER_STARTED       = 'indexer.started',
  INDEXER_FILE_ADDED    = 'indexer.file_added',
  INDEXER_FILE_CHANGED  = 'indexer.file_changed',
  INDEXER_FILE_DELETED  = 'indexer.file_deleted',
  INDEXER_FILE_SKIPPED  = 'indexer.file_skipped',
  INDEXER_FLUSH         = 'indexer.flush',
  PARSER_FILE_PARSED    = 'parser.file_parsed',
  PARSER_REFS_EXTRACTED = 'parser.refs_extracted',
  TOOL_CALLED           = 'tool.called',
  TOOL_ERROR            = 'tool.error',
  FRAMEWORK_DETECTED    = 'framework.detected',
  FRAMEWORK_TRACED      = 'framework.traced',
  SERVER_STARTED        = 'server.started',
  SERVER_SHUTDOWN       = 'server.shutdown'
}
