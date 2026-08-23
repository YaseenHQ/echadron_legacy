/**
 * `tools` domain (L7) — `BrowserTool` implementation.
 *
 * Picks whichever backend is reachable: Echadron's own CDP client first, then
 * an adapter for a locally installed Kimi WebBridge daemon. The daemon is a
 * separate proprietary product and is never bundled — the adapter only speaks
 * to one the user installed. See `#/app/browser/backend`.
 *
 * Bound at Agent scope; self-registers via `registerAgentToolService(...)`.
 */

import { toInputJsonSchema } from '#/tool/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '#/tool/rule-match';
import {
  ToolAccesses,
  type ExecutableToolContext,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';
import { ToolResultBuilder } from '#/tool/result-builder';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';

import { BrowserUnavailableError, type BrowserBackend } from '#/app/browser/backend';
import { CdpBrowserBackend } from '#/app/browser/cdpBackend';
import { WebBridgeBackend } from '#/app/browser/webBridgeBackend';
import { BrowserInputSchema, IBrowserTool, type BrowserInput } from './browser';
import DESCRIPTION from './browser.md?raw';

const NO_BACKEND_MESSAGE =
  'No browser is reachable. Start Chrome or Edge with --remote-debugging-port=9222 using your normal profile, or install the Kimi WebBridge daemon (https://www.kimi.com/features/webbridge). Tell the user which they prefer rather than retrying.';

/** Cap on returned page text; a long article otherwise floods the turn. */
const MAX_TEXT_CHARS = 40_000;

export class BrowserTool implements IBrowserTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Browser' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(BrowserInputSchema);

  private readonly backends: readonly BrowserBackend[];

  constructor(backends?: readonly BrowserBackend[]) {
    // Ours first: it needs no third-party daemon.
    this.backends = backends ?? [new CdpBrowserBackend(), new WebBridgeBackend()];
  }

  /**
   * Detach every backend when the agent scope ends. The CDP client holds an
   * open WebSocket; without this each agent that browsed would leak one and
   * keep a ref'd handle alive.
   */
  async dispose(): Promise<void> {
    await Promise.all(this.backends.map(async (backend) => backend.close().catch(() => {})));
  }

  /**
   * The approval subject must be the operand this action actually uses, not
   * whichever optional field happens to be set. Otherwise a `read` carrying a
   * stale `url` would reuse that url's approval while reading a different page.
   */
  private static subjectOf(args: BrowserInput): string {
    switch (args.action) {
      case 'navigate':
        return `navigate ${args.url ?? ''}`.trim();
      case 'click':
      case 'type':
        return `${args.action} ${args.selector ?? ''}`.trim();
      default:
        return args.action;
    }
  }

  resolveExecution(args: BrowserInput): ToolExecution {
    const subject = BrowserTool.subjectOf(args);
    return {
      // One shared tab and socket: parallel browser calls would interleave
      // keystrokes and navigations, so they must serialize against each other.
      accesses: ToolAccesses.all(),
      description: `Browser: ${args.action}${args.url === undefined ? '' : ` ${args.url}`}`,
      display: { kind: 'generic', summary: `Browser ${args.action}` },
      approvalRule: literalRulePattern(this.name, subject),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, subject),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async pick(): Promise<BrowserBackend> {
    for (const backend of this.backends) {
      if (await backend.available()) return backend;
    }
    throw new BrowserUnavailableError(NO_BACKEND_MESSAGE);
  }

  private async execution(
    args: BrowserInput,
    { signal }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      signal.throwIfAborted();
      const backend = await this.pick();
      signal.throwIfAborted();
      const builder = new ToolResultBuilder({ maxLineLength: null });
      switch (args.action) {
        case 'navigate': {
          if (args.url === undefined) return { isError: true, output: '`navigate` needs a url.' };
          const page = await backend.navigate(args.url);
          builder.write(`Opened ${page.url}\nTitle: ${page.title}`);
          return builder.ok();
        }
        case 'read': {
          const text = await backend.readText();
          const clipped = text.length > MAX_TEXT_CHARS;
          builder.write(
            clipped
              ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated at ${String(MAX_TEXT_CHARS)} characters]`
              : text,
          );
          return builder.ok();
        }
        case 'click': {
          if (args.selector === undefined) return { isError: true, output: '`click` needs a selector.' };
          await backend.click(args.selector);
          builder.write(`Clicked ${args.selector}`);
          return builder.ok();
        }
        case 'type': {
          if (args.selector === undefined || args.text === undefined) {
            return { isError: true, output: '`type` needs both a selector and text.' };
          }
          await backend.type(args.selector, args.text);
          builder.write(`Typed into ${args.selector}`);
          return builder.ok();
        }
        case 'screenshot': {
          const png = await backend.screenshot();
          // Return the image itself; a byte count tells the model nothing.
          const base64 = Buffer.from(png).toString('base64');
          return {
            isError: false,
            output: [
              { type: 'text', text: `<image source="browser:${backend.id}">` },
              { type: 'image_url', imageUrl: { url: `data:image/png;base64,${base64}` } },
              { type: 'text', text: '</image>' },
            ],
          };
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, output: message };
    }
  }
}

registerAgentToolService(IBrowserTool, BrowserTool, { name: 'Browser', domain: 'browser' });
