/**
 * @file prompt.ts
 * @description Generates the quick-start prompt for MCP clients, including the exact
 * connection config so any agent can wire itself to this server instance.
 * @module tools
 */

/**
 * @description Builds the ready-to-paste agent prompt with real runtime paths injected,
 * so an agent on any machine can locate and connect to this specter-tree instance.
 * @param serverPath - Absolute path to this server's entry point (import.meta.filename).
 * @param projectRoot - Absolute path to the indexed TypeScript project.
 * @returns Complete prompt string — safe to print to stdout or embed in a banner.
 */
export function getQuickStartPrompt(serverPath: string, projectRoot: string): string {
  const config = JSON.stringify({
    mcpServers: {
      tsa: {
        command: 'bun',
        args: ['run', serverPath],
        env: { TSA_PROJECT_ROOT: projectRoot }
      }
    }
  }, null, 2);

  return `\
specter-tree MCP server is available for this TypeScript project.

STEP 1 — Connect the MCP server
Add the following to your .mcp.json (Claude Code), mcp.json (Cursor), or equivalent config:

${config}

Save the file, then reload / restart your agent session so it picks up the new server.

STEP 2 — Confirm connection
Once reloaded, confirm "tsa" appears in your connected MCP servers and list its tools.
Do not ask the user to wire this manually — the config above is complete and ready.

OPERATING RULES
1. Use tsa as your default navigation tool for this codebase.
2. Never start with grep, glob, or broad file reads when tsa can answer the question.
3. Call a tsa tool to get the exact file + line before opening any file.
4. After editing a file, call flush_file(file_path) so the index stays current.
5. Fall back to grep/glob only for node_modules, generated files, or external APIs not in the index.

RECOMMENDED STARTUP SEQUENCE
1. Confirm tsa is connected and list available tools.
2. Use find_symbol or search_symbols to locate the relevant symbol.
3. Read only the lines around that symbol — not the full file.
4. Make the change, flush the file, continue with tsa-first navigation.

SYMBOL LOOKUP
  find_symbol(name)              exact match -> file + line + signature
  search_symbols(query, limit?)  partial/fuzzy match
  get_file_symbols(file_path)    every symbol declared in a file
  get_methods(class_name)        all methods + properties on a class

RELATIONSHIPS
  get_callers(symbol_name)             every verified call site
  get_hierarchy(class_name)            extends / implements chain
  get_implementations(interface_name)  all classes implementing it
  get_related_files(file_path)         import / imported-by graph

FRAMEWORK & CONFIG
  trace_middleware(route_path)  middleware execution order for a route
  get_route_config(url_path)    handler, guards, redirects
  resolve_config(key)           resolved value + full source chain

INSIGHT
  summarize_file_structure(file_path)                              compact anatomy: exports, classes, functions
  explain_flow({ symbol_name? | file_path? | route_path? }, max_depth?)  bounded call-graph (one entrypoint)
  find_write_targets(symbol_name)                                  ranked edit locations
  resolve_exports(file_path, export_name)                          follow barrel re-exports to declaration

INDEX CONTROL
  flush_file(file_path)  force immediate re-index after an edit
  index_project(root)    full re-scan

MCP RESOURCES (browse index without a tool call)
  tsa://files              all indexed TypeScript file paths
  tsa://symbols            all distinct symbol names
  tsa://file/{path}        every symbol declared in a specific file
  tsa://symbol/{name}      full record for a named symbol

Indexed project: ${projectRoot}`;
}
