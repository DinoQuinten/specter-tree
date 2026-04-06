# Contributing to Specter-Tree

Thanks for contributing. Specter-Tree is a TypeScript MCP server focused on code navigation, structural queries, and lower-token AI coding workflows.

## Development Setup

```bash
git clone https://github.com/DinoQuinten/specter-tree.git
cd specter-tree/tsa-mcp-server
bun install
```

## Run the Project

```bash
bun run dev
```

## Verify Changes

Run these commands from `tsa-mcp-server/` before opening a pull request:

```bash
bun test
bun run typecheck
```

## Pull Requests

- Keep changes focused and scoped to the problem being solved.
- Update documentation when behavior, setup, or public tool output changes.
- Add or update tests when code behavior changes.
- Include a clear summary of the user-visible impact in the PR description.

## Issues

When filing an issue, include:

- What you expected to happen
- What actually happened
- Reproduction steps
- Relevant project setup details such as Bun version, OS, and framework

## Security

Do not open public issues for sensitive vulnerabilities. Use GitHub security reporting if the issue could expose users or repositories.
