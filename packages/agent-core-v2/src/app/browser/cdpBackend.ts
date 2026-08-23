/**
 * `browser` domain (L4) — Echadron's own browser control, over the Chrome
 * DevTools Protocol.
 *
 * This owes nothing to any third party. The user starts their normal Chrome or
 * Edge with `--remote-debugging-port=9222`; the browser then serves a small
 * HTTP endpoint listing its open targets, each with a WebSocket URL that speaks
 * CDP. We attach to the first ordinary page target and drive it.
 *
 * Because it is the user's own profile, pages are already logged in — the same
 * property that makes a bridge daemon useful, without the daemon.
 *
 * Only the handful of CDP domains we need are used (`Page`, `Runtime`,
 * `Input`), so there is no dependency beyond the WebSocket built into Node.
 */

import { BrowserUnavailableError, type BrowserBackend, type BrowserPage } from './backend';

const DEFAULT_DEBUG_ORIGIN = 'http://127.0.0.1:9222';
const CALL_TIMEOUT_MS = 30_000;

interface CdpTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly webSocketDebuggerUrl?: string;
}

export class CdpBrowserBackend implements BrowserBackend {
  readonly id = 'cdp' as const;

  private socket: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void }
  >();

  constructor(private readonly origin: string = DEFAULT_DEBUG_ORIGIN) {}

  async available(): Promise<boolean> {
    try {
      return (await this.pageTarget(2_000)) !== undefined;
    } catch {
      return false;
    }
  }

  async navigate(url: string): Promise<BrowserPage> {
    await this.call('Page.enable', {});
    await this.call('Page.navigate', { url });
    // Settle before reading: a navigate resolves on commit, not on load.
    await this.evaluate<string>(
      'new Promise(r => document.readyState === "complete" ? r("") : addEventListener("load", () => r(""), { once: true }))',
    );
    return {
      url: await this.evaluate<string>('location.href'),
      title: await this.evaluate<string>('document.title'),
    };
  }

  async readText(): Promise<string> {
    return this.evaluate<string>('document.body ? document.body.innerText : ""');
  }

  async click(selector: string): Promise<void> {
    const found = await this.evaluate<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    );
    if (!found) throw new BrowserUnavailableError(`No element matches ${selector}.`);
  }

  async type(selector: string, text: string): Promise<void> {
    const focused = await this.evaluate<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`,
    );
    if (!focused) throw new BrowserUnavailableError(`No element matches ${selector}.`);
    // Real key events, so frameworks listening for input see them.
    for (const char of text) {
      await this.call('Input.dispatchKeyEvent', { type: 'keyDown', text: char });
      await this.call('Input.dispatchKeyEvent', { type: 'keyUp', text: char });
    }
  }

  async screenshot(): Promise<Uint8Array> {
    const result = await this.call('Page.captureScreenshot', { format: 'png' });
    const data = typeof result['data'] === 'string' ? result['data'] : '';
    if (data === '') throw new BrowserUnavailableError('Chrome returned no screenshot data.');
    return Uint8Array.from(Buffer.from(data, 'base64'));
  }

  async close(): Promise<void> {
    // Detach only. The browser is the user's, and stays open.
    this.socket?.close();
    this.socket = undefined;
    for (const { reject } of this.pending.values()) {
      reject(new BrowserUnavailableError('The CDP connection closed.'));
    }
    this.pending.clear();
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const wrapper = result['result'];
    const value = typeof wrapper === 'object' && wrapper !== null
      ? (wrapper as Record<string, unknown>)['value']
      : undefined;
    return value as T;
  }

  private async pageTarget(timeoutMs = CALL_TIMEOUT_MS): Promise<CdpTarget | undefined> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}/json/list`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BrowserUnavailableError(
        `No debuggable browser at ${this.origin}. Start Chrome or Edge with --remote-debugging-port=9222, using your normal profile so pages stay signed in. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const targets = (await response.json()) as readonly CdpTarget[];
    return targets.find(
      (target) => target.type === 'page' && target.webSocketDebuggerUrl !== undefined,
    );
  }

  private async connect(): Promise<WebSocket> {
    if (this.socket !== undefined && this.socket.readyState === WebSocket.OPEN) return this.socket;
    const target = await this.pageTarget();
    if (target?.webSocketDebuggerUrl === undefined) {
      throw new BrowserUnavailableError(
        'The browser is running but has no open page to attach to. Open a tab and retry.',
      );
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new BrowserUnavailableError('CDP connect failed.')), { once: true });
    });
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      const id = typeof frame['id'] === 'number' ? frame['id'] : undefined;
      if (id === undefined) return; // an event, not a reply
      const waiter = this.pending.get(id);
      if (waiter === undefined) return;
      this.pending.delete(id);
      const error = frame['error'];
      if (error !== undefined) {
        const raw =
          typeof error === 'object' && error !== null
            ? (error as Record<string, unknown>)['message']
            : undefined;
        const message = typeof raw === 'string' && raw !== '' ? raw : 'CDP error';
        waiter.reject(new BrowserUnavailableError(message));
        return;
      }
      const result = frame['result'];
      waiter.resolve(typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {});
    });
    this.socket = socket;
    return socket;
  }

  private async call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = await this.connect();
    const id = this.nextId++;
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    socket.send(JSON.stringify({ id, method, params }));
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        this.pending.delete(id);
        reject(new BrowserUnavailableError(`CDP call ${method} timed out.`));
      }, CALL_TIMEOUT_MS).unref?.();
    });
    return Promise.race([reply, timeout]);
  }
}
