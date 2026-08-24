---
'@yaseenhq/agent-core-v2': minor
'@yaseenhq/tsugite': minor
'echadron': minor
---

Rename the provider layer to Tsugite and move every workspace package to the `@yaseenhq` scope

The provider abstraction layer is now `Tsugite` — Japanese joinery, interlocking
joints that hold without nails. It describes what the layer does: it mates
different model APIs to one interface.

Every workspace package also moves off the `@moonshot-ai` scope, which this fork
has no claim to, and the harness packages drop the `kimi-code` prefix:

- `@moonshot-ai/kimi-code-sdk` is now `@yaseenhq/echadron-sdk`
- `@moonshot-ai/kimi-code-oauth` is now `@yaseenhq/echadron-oauth`
- `@moonshot-ai/kimi-telemetry` is now `@yaseenhq/echadron-telemetry`
- `@moonshot-ai/kimi-inspect` is now `@yaseenhq/echadron-inspect`
- every other `@moonshot-ai/*` package keeps its name under `@yaseenhq/*`

The `apps/kimi-code` and `apps/kimi-inspect` directories are now `apps/echadron`
and `apps/echadron-inspect`.

Every package involved is private, so nothing published changes. The Kimi
provider, its OAuth flow and its models are untouched: those are Moonshot
products that Echadron integrates with, exactly like any other provider.
