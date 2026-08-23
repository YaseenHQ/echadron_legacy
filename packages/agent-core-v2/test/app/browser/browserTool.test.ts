import { describe, expect, it } from 'vitest';

import { BrowserUnavailableError, type BrowserBackend, type BrowserPage } from '#/app/browser/backend';
import { BrowserTool } from '#/agent/tools/browser/browserTool';
import { ToolAccesses } from '#/tool/toolContract';

function fakeBackend(overrides: Partial<BrowserBackend> & { id?: BrowserBackend['id'] } = {}): BrowserBackend {
  return {
    id: overrides.id ?? 'cdp',
    available: overrides.available ?? (async () => true),
    navigate: overrides.navigate ?? (async (url: string): Promise<BrowserPage> => ({ url, title: 'T' })),
    readText: overrides.readText ?? (async () => 'body text'),
    click: overrides.click ?? (async () => {}),
    type: overrides.type ?? (async () => {}),
    screenshot: overrides.screenshot ?? (async () => new Uint8Array([1, 2, 3])),
    close: overrides.close ?? (async () => {}),
  };
}

const ctx = { toolCallId: 't1', signal: new AbortController().signal } as never;

/** Tool output is a union; these cases all assert on its text form. */
function outputText(result: { output?: unknown }): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

async function run(tool: BrowserTool, args: Parameters<BrowserTool['resolveExecution']>[0]) {
  const execution = tool.resolveExecution(args);
  // ToolExecution is a union: a runnable one, or an error result returned
  // before anything runs. Both are valid outcomes for these cases.
  if (!('execute' in execution)) return execution;
  return execution.execute(ctx);
}

describe('Browser tool', () => {
  it('prefers our own CDP backend over the third-party daemon', async () => {
    const order: string[] = [];
    const tool = new BrowserTool([
      fakeBackend({ id: 'cdp', available: async () => { order.push('cdp'); return true; } }),
      fakeBackend({ id: 'webbridge', available: async () => { order.push('webbridge'); return true; } }),
    ]);

    const result = await run(tool, { action: 'screenshot' });

    expect(order).toEqual(['cdp']);
    expect(outputText(result)).toContain('browser:cdp');
  });

  it('falls back to the daemon when no debuggable browser is running', async () => {
    const tool = new BrowserTool([
      fakeBackend({ id: 'cdp', available: async () => false }),
      fakeBackend({ id: 'webbridge' }),
    ]);

    expect(outputText(await run(tool, { action: 'screenshot' }))).toContain('browser:webbridge');
  });

  it('tells the user how to start a browser when neither backend answers', async () => {
    // The failure a user actually hits: nothing configured. The message must
    // carry both remedies, because retrying can never help.
    const tool = new BrowserTool([
      fakeBackend({ id: 'cdp', available: async () => false }),
      fakeBackend({ id: 'webbridge', available: async () => false }),
    ]);

    const result = await run(tool, { action: 'read' });

    expect(result.isError).toBe(true);
    expect(outputText(result)).toContain('--remote-debugging-port=9222');
    expect(outputText(result)).toContain('WebBridge');
  });

  it('never treats an unavailable backend as a crash', async () => {
    const tool = new BrowserTool([
      fakeBackend({ available: async () => { throw new Error('socket exploded'); } }),
    ]);
    // A probe that throws must surface as a tool error the model can read,
    // not as an exception that aborts the turn.
    const result = await run(tool, { action: 'read' });

    expect(result.isError).toBe(true);
    expect(outputText(result)).toContain('socket exploded');
  });

  it('reports a missing argument instead of calling the backend', async () => {
    let navigated = false;
    const tool = new BrowserTool([
      fakeBackend({ navigate: async () => { navigated = true; return { url: '', title: '' }; } }),
    ]);

    const result = await run(tool, { action: 'navigate' });

    expect(result.isError).toBe(true);
    expect(navigated).toBe(false);
  });

  it('truncates a very long page instead of flooding the turn', async () => {
    const tool = new BrowserTool([fakeBackend({ readText: async () => 'x'.repeat(60_000) })]);

    const output = outputText(await run(tool, { action: 'read' }));

    expect(output).toContain('[truncated at 40000 characters]');
    expect(output.length).toBeLessThan(60_000);
  });

  it('surfaces a backend error as a tool error, not an exception', async () => {
    const tool = new BrowserTool([
      fakeBackend({ click: async () => { throw new BrowserUnavailableError('No element matches #gone.'); } }),
    ]);

    const result = await run(tool, { action: 'click', selector: '#gone' });

    expect(result.isError).toBe(true);
    expect(outputText(result)).toContain('No element matches');
  });

  it('returns the screenshot as an image, not a byte count', async () => {
    const tool = new BrowserTool([fakeBackend({ screenshot: async () => new Uint8Array([137, 80, 78, 71]) })]);

    const result = await run(tool, { action: 'screenshot' });
    const parts = result.output as { type: string; imageUrl?: { url: string } }[];

    const image = parts.find((part) => part.type === 'image_url');
    expect(image?.imageUrl?.url).toBe(`data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`);
  });

  it('scopes the approval subject to the operand the action uses', async () => {
    const tool = new BrowserTool([fakeBackend()]);

    // A `read` that still carries a stale url must not reuse that url's approval.
    const navigate = tool.resolveExecution({ action: 'navigate', url: 'https://example.com' });
    const read = tool.resolveExecution({ action: 'read', url: 'https://example.com' } as never);

    expect('approvalRule' in navigate && 'approvalRule' in read).toBe(true);
    expect((navigate as { approvalRule: unknown }).approvalRule).not.toEqual(
      (read as { approvalRule: unknown }).approvalRule,
    );
  });

  it('serializes against other browser calls, because there is one shared tab', async () => {
    const tool = new BrowserTool([fakeBackend()]);

    const left = tool.resolveExecution({ action: 'read' });
    const right = tool.resolveExecution({ action: 'click', selector: '#a' });

    expect('accesses' in left && 'accesses' in right).toBe(true);
    expect(
      ToolAccesses.conflict(
        (left as { accesses: ToolAccesses }).accesses,
        (right as { accesses: ToolAccesses }).accesses,
      ),
    ).toBe(true);
  });

  it('stops before touching a backend when the call is already cancelled', async () => {
    let touched = false;
    const tool = new BrowserTool([fakeBackend({ available: async () => { touched = true; return true; } })]);
    const aborted = AbortSignal.abort();

    const execution = tool.resolveExecution({ action: 'read' });
    // Cancellation propagates rather than becoming a tool error, so the turn
    // sees an interrupt and not a failed browser call.
    await expect(
      (execution as { execute: (c: never) => Promise<unknown> }).execute({
        toolCallId: 't1',
        signal: aborted,
      } as never),
    ).rejects.toThrow();
    expect(touched).toBe(false);
  });

  it('closes every backend on dispose so no socket leaks', async () => {
    const closed: string[] = [];
    const tool = new BrowserTool([
      fakeBackend({ id: 'cdp', close: async () => { closed.push('cdp'); } }),
      fakeBackend({ id: 'webbridge', close: async () => { closed.push('webbridge'); } }),
    ]);

    await tool.dispose();

    expect(closed).toEqual(['cdp', 'webbridge']);
  });
});
