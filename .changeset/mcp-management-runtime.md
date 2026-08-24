---
'@yaseenhq/agent-core-v2': minor
'@yaseenhq/echadron-oauth': minor
---

Complete the MCP management plane and add the runtime layer

The management API, the App-scoped OAuth service and the runtime layer now land
alongside the config store and registry:

- `runtime` — the runtime abstraction, registry, local runtime and unit host
- `app/agentIdentity` — the identity a client advertises on MCP initialize
- `app/mcpManagement` — list, add, update, remove and probe servers
- `app/mcpConfig/oauthService` — proactive token refresh at App scope

The OAuth layer takes upstream's implementation, which is materially better than
what was here: token transactions that invalidate a spent grant, proactive
refresh, and `obtained_at` stamped on save so refresh can tell a token's age.
Two behaviours from this fork are preserved on top of it — the loopback client
still registers as a native application per SEP-837, and the whole layer runs on
`@modelcontextprotocol/client` 2.0 rather than the 1.x SDK.

A refresh token the authorization server rejects now moves a server to
`needs-auth` instead of `failed`. The grant is spent and no retry recovers it,
so the only way forward is to log in again, and the status now says so.

Stdio probes always run on the local runtime. Upstream binds them to the
workspace instance containing the cwd; there is no workspace-instance layer
here yet, and every stdio server already runs locally.
