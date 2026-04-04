CREATE TABLE IF NOT EXISTS symbols (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN (
    'class','interface','enum','type_alias','function',
    'method','property','constructor','getter','setter',
    'enum_member','variable'
  )),
  file_path   TEXT NOT NULL,
  line        INTEGER NOT NULL,
  column      INTEGER DEFAULT 0,
  end_line    INTEGER,
  parent_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  signature   TEXT,
  modifiers   TEXT DEFAULT '',
  return_type TEXT,
  params      TEXT,
  doc_comment TEXT,
  UNIQUE(file_path, name, kind, line)
);

CREATE INDEX IF NOT EXISTS idx_symbols_name      ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_file      ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_kind      ON symbols(kind);
CREATE INDEX IF NOT EXISTS idx_symbols_parent    ON symbols(parent_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name_kind ON symbols(name, kind);
CREATE INDEX IF NOT EXISTS idx_symbols_file_kind ON symbols(file_path, kind);

CREATE TABLE IF NOT EXISTS "references" (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  ref_kind         TEXT NOT NULL CHECK(ref_kind IN (
    'calls','imports','extends','implements','type_ref','decorator'
  )),
  source_line      INTEGER,
  confidence       TEXT DEFAULT 'direct' CHECK(confidence IN ('direct','inferred','weak'))
);

CREATE INDEX IF NOT EXISTS idx_refs_source      ON "references"(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_refs_target      ON "references"(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_refs_kind        ON "references"(ref_kind);
CREATE INDEX IF NOT EXISTS idx_refs_target_kind ON "references"(target_symbol_id, ref_kind);

CREATE TABLE IF NOT EXISTS files (
  path          TEXT PRIMARY KEY,
  last_modified INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  symbol_count  INTEGER DEFAULT 0,
  index_time_ms INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO project_meta (key, value) VALUES ('schema_version', '1');
