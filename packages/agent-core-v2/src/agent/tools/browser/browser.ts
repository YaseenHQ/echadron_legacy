/**
 * `tools` domain (L7) — `IBrowserTool` contract.
 *
 * Drives the user's own browser, so pages the model reads are the pages the
 * user is signed into. Two backends satisfy it (see `#/app/browser/backend`):
 * Echadron's own CDP client, and an adapter for a Kimi WebBridge daemon the
 * user installed themselves.
 *
 * Owns the `BrowserInput` zod schema and the Agent-scope service identifier.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const BrowserInputSchema = z.object({
  action: z
    .enum(['navigate', 'read', 'click', 'type', 'screenshot'])
    .describe(
      'What to do: navigate to a url, read the page text, click a selector, type into a selector, or capture a screenshot.',
    ),
  url: z.string().optional().describe('Required for "navigate". The page to open.'),
  selector: z
    .string()
    .optional()
    .describe('Required for "click" and "type". A CSS selector for the target element.'),
  text: z.string().optional().describe('Required for "type". The text to enter.'),
});

export type BrowserInput = z.infer<typeof BrowserInputSchema>;

export interface IBrowserTool extends AgentTool<BrowserInput> {
  readonly _serviceBrand: undefined;
}
export const IBrowserTool = createDecorator<IBrowserTool>('browserTool');
