# `@yaseenhq/acp-server`

ACP protocol-v2 transport for Echadron.

The package deliberately sits beside `@yaseenhq/acp-adapter`: the v1
adapter continues to own ACP v1, while this package uses the official SDK's
`@agentclientprotocol/sdk-v2/experimental/v2` entry point and reuses the existing
Echadron `KimiHarness` session/event mapping. The main `echadron acp` command
selects between them from the client's initialize frame without changing the
current provider, auth, or session stores.

ACP v2 remains an evolving wire contract even though Echadron supports it on
the main ACP path. This package follows the active v2 RFDs for prompt acknowledgement and state
updates, whole-message replay, tool-call upserts, structured permissions,
agent-owned display-only terminals, item-based plans, and explicit additional
workspace roots. See the [ACP v2 proposal](https://agentclientprotocol.com/rfds/v2/overview)
and the [v2 migration guide](https://agentclientprotocol.com/protocol/v2/migration).
