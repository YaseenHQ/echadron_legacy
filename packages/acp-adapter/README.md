# @yaseenhq/acp-adapter

Agent Client Protocol adapter for Echadron. Exposes the Echadron agent over the [Agent Client Protocol](https://agentclientprotocol.com/) so that ACP-compatible clients (editors, IDEs, custom front-ends) can drive an Echadron session over stdio.

Part of the Echadron monorepo.

## Minimum usage

```ts
import { createKimiHarness } from '@yaseenhq/echadron-sdk';
import { runAcpServer } from '@yaseenhq/acp-adapter';

const harness = await createKimiHarness();
await runAcpServer(harness);
```

`runAcpServer` reads JSON-RPC from `process.stdin`, writes to `process.stdout`, and resolves when the client closes the connection. SIGINT and SIGTERM trigger a graceful drain that calls `harness.close()` before the process exits.

See `docs/en/reference/kimi-acp.md` for the full capability matrix (including additional workspace roots, live context usage, model metadata, and provider-management boundaries) and `docs/en/guides/ides.md` for Zed and JetBrains setup.

## License

MIT
