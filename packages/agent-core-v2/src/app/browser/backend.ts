/**
 * `browser` domain (L4) — the backend contract for driving a real browser.
 *
 * Two implementations satisfy it. `CdpBrowserBackend` speaks the Chrome
 * DevTools Protocol to a Chrome started with `--remote-debugging-port`, and
 * owes nothing to anyone. `WebBridgeBackend` speaks the local HTTP protocol of
 * the Kimi WebBridge daemon, which some users already run; that daemon is a
 * separate, proprietary product and is never bundled here — the adapter only
 * talks to one the user installed.
 *
 * Both drive the user's own browser profile, so pages stay logged in. Neither
 * launches a headless instance.
 */

export interface BrowserPage {
  readonly url: string;
  readonly title: string;
}

export interface BrowserBackend {
  /** Short name shown to the user when reporting which backend answered. */
  readonly id: 'cdp' | 'webbridge';
  /** Whether this backend can serve requests right now. Never throws. */
  available(): Promise<boolean>;
  navigate(url: string): Promise<BrowserPage>;
  /** Visible text of the active page, truncated by the caller. */
  readText(): Promise<string>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  /** PNG bytes of the viewport. */
  screenshot(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}
