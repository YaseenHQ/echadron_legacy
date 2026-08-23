import { describe, expect, it } from 'vitest';

import { CdpBrowserBackend } from '#/app/browser/cdpBackend';

/**
 * Exercises the real Chrome DevTools Protocol, not a fake. It needs a browser
 * started with `--remote-debugging-port=9222`, so it skips when there is none —
 * CI has no browser, and a skipped check must never read as a passing one.
 *
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/p about:blank
 */
async function debuggableBrowserPresent(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version', {
      signal: AbortSignal.timeout(1_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const present = await debuggableBrowserPresent();

describe.skipIf(!present)('CdpBrowserBackend against a real browser', () => {
  it('navigates, reads the page, and captures a screenshot', async () => {
    const backend = new CdpBrowserBackend();
    try {
      expect(await backend.available()).toBe(true);

      const page = await backend.navigate(
        'data:text/html,<title>Echadron</title><h1>hello from cdp</h1>',
      );
      expect(page.title).toBe('Echadron');

      expect(await backend.readText()).toContain('hello from cdp');

      const png = await backend.screenshot();
      // PNG magic number, so a truncated or base64-mangled buffer fails here.
      expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } finally {
      await backend.close();
    }
  });

  it('reports a missing element instead of silently doing nothing', async () => {
    const backend = new CdpBrowserBackend();
    try {
      await backend.navigate('data:text/html,<button id="real">ok</button>');
      await expect(backend.click('#not-here')).rejects.toThrow('No element matches');
      await expect(backend.click('#real')).resolves.toBeUndefined();
    } finally {
      await backend.close();
    }
  });
});

describe.skipIf(present)('CdpBrowserBackend with no browser running', () => {
  it('reports unavailable rather than throwing', async () => {
    expect(await new CdpBrowserBackend('http://127.0.0.1:59999').available()).toBe(false);
  });
});
