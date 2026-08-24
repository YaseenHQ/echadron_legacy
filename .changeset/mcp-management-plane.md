---
'@yaseenhq/agent-core-v2': minor
---

Hoist MCP into a layered management plane

MCP lived entirely inside the agent scope, so every agent re-read the config and
owned its own view of which servers exist. The transport layer now sits in
`mcpCore`, and configuration, the registry and the management API are App-scoped
above it, matching upstream's structure:

- `mcpCore` — clients, config schema, connection manager, errors and OAuth
- `app/mcpConfig` — the `mcp.json` store, config section and loader
- `app/mcpRegistry` — resolves global, project and plugin servers by name
- `agent/mcp` — the agent-facing service and tools, unchanged in behaviour

Echadron's own MCP client stays. It is on `@modelcontextprotocol/client` 2.0.0
and handles the 2026-07-28 protocol, which removed protocol-level `ping`;
upstream is still on the 1.x SDK. Only the layering is adopted, not the
transport code.
