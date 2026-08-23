/**
 * `browser` domain (L4) — adapter for a locally installed Kimi WebBridge daemon.
 *
 * The daemon is a separate product by Moonshot AI, distributed under its own
 * proprietary licence. Nothing from it is vendored, rebranded or redistributed
 * here: this file only speaks its local HTTP protocol, the same way any client
 * speaks to a third-party service on loopback. A user who has not installed the
 * daemon simply gets `available() === false`, and the CDP backend serves
 * instead.
 *
 * The protocol is undocumented and unversioned, so treat every response as
 * untrusted shape and degrade rather than throw on anything unexpected.
 */

import { BrowserUnavailableError, type BrowserBackend, type BrowserPage } from './backend';

const DAEMON_ORIGIN = 'http://127.0.0.1:10086';
const REQUEST_TIMEOUT_MS = 30_000;

interface DaemonEnvelope {
  readonly ok?: boolean;
  readonly error?: string;
  readonly data?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export class WebBridgeBackend implements BrowserBackend {
  readonly id = 'webbridge' as const;

  constructor(private readonly origin: string = DAEMON_ORIGIN) {}

  async available(): Promise<boolean> {
    try {
      const res = await this.post('status', {}, 2_000);
      return res.ok !== false;
    } catch {
      return false;
    }
  }

  async navigate(url: string): Promise<BrowserPage> {
    const data = asRecord((await this.post('navigate', { url })).data);
    return { url: asString(data['url'], url), title: asString(data['title']) };
  }

  async readText(): Promise<string> {
    return asString(asRecord((await this.post('read_text', {})).data)['text']);
  }

  async click(selector: string): Promise<void> {
    await this.post('click', { selector });
  }

  async type(selector: string, text: string): Promise<void> {
    await this.post('type', { selector, text });
  }

  async screenshot(): Promise<Uint8Array> {
    const data = asRecord((await this.post('screenshot', {})).data);
    const encoded = asString(data['png'] ?? data['image']);
    if (encoded === '') throw new BrowserUnavailableError('WebBridge returned no screenshot data.');
    return Uint8Array.from(Buffer.from(encoded, 'base64'));
  }

  async close(): Promise<void> {
    // The daemon owns the browser lifecycle; a client never closes it.
  }

  private async post(
    command: string,
    args: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<DaemonEnvelope> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.origin}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, ...args }),
        signal,
      });
    } catch (error) {
      throw new BrowserUnavailableError(
        `The Kimi WebBridge daemon is not reachable at ${this.origin}. Install it from https://www.kimi.com/features/webbridge, or start Chrome with --remote-debugging-port to use the built-in CDP backend instead. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (!response.ok) {
      throw new BrowserUnavailableError(
        `WebBridge rejected "${command}" with HTTP ${response.status}.`,
      );
    }
    const body = (await response.json()) as DaemonEnvelope;
    if (body.ok === false) {
      throw new BrowserUnavailableError(`WebBridge failed "${command}": ${body.error ?? 'unknown'}`);
    }
    return body;
  }
}
