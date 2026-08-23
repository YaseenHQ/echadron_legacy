import { describe, expect, it } from 'vitest';

import {
  OAuthCallbackClosedError,
  startCallbackServer,
} from '#/mcpCore/oauth/callback-server';

describe('MCP OAuth callback server', () => {
  it('settles a pending waitForCode when the listener is closed', async () => {
    // Cancelling an in-flight authorization closes the listener. The browser
    // can no longer deliver a code, so a waiter that is not settled here sits
    // until its timeout instead of failing immediately.
    const server = await startCallbackServer();
    const pending = server.waitForCode({ timeoutMs: 60_000 });
    await server.close();
    await expect(pending).rejects.toBeInstanceOf(OAuthCallbackClosedError);
  });

  it('closing twice is harmless', async () => {
    const server = await startCallbackServer();
    const pending = server.waitForCode({ timeoutMs: 60_000 });
    await server.close();
    await server.close();
    await expect(pending).rejects.toBeInstanceOf(OAuthCallbackClosedError);
  });
});
