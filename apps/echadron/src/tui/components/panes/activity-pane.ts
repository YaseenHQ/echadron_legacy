import { Container, Spacer, visibleWidth } from '@yaseenhq/pi-tui';

import type { MoonLoader } from '#/tui/components/chrome/moon-loader';
import { currentTheme } from '#/tui/theme';
import { formatTurnElapsed } from '#/tui/utils/turn-status';

export type ActivityPaneMode =
  | 'hidden'
  | 'waiting'
  | 'thinking'
  | 'composing'
  | 'tool'
  | 'awaiting';

export interface ActivityPaneOptions {
  readonly mode: ActivityPaneMode;
  readonly spinner?: MoonLoader;
  readonly tip?: string;
  /** Wall-clock start of the live turn. Omit to hide the Grok-style elapsed. */
  readonly startedAt?: number;
  readonly now?: () => number;
}

export class ActivityPaneComponent extends Container {
  private spinnerRef?: MoonLoader;
  private readonly startedAt: number | undefined;
  private readonly now: () => number;

  constructor(options: ActivityPaneOptions) {
    super();
    this.spinnerRef = options.spinner;
    this.startedAt = options.startedAt;
    this.now = options.now ?? Date.now;

    if (
      (options.mode === 'waiting' || options.mode === 'tool' || options.mode === 'composing') &&
      options.spinner !== undefined
    ) {
      this.addChild(new Spacer(1));
      if (options.tip) {
        options.spinner.setTip(` · Tip: ${options.tip}`);
      }
      this.addChild(options.spinner);
    }
  }

  override render(width: number): string[] {
    const elapsed = this.elapsedText();
    const elapsedWidth = elapsed === undefined ? 0 : visibleWidth(elapsed) + 1;
    if (this.spinnerRef && 'setAvailableWidth' in this.spinnerRef) {
      this.spinnerRef.setAvailableWidth(Math.max(0, width - elapsedWidth));
    }
    const lines = super.render(width);
    if (elapsed === undefined || lines.length === 0) return lines;
    const last = lines.length - 1;
    const body = (lines[last] ?? '').trimEnd();
    const pad = width - visibleWidth(body) - visibleWidth(elapsed);
    if (pad < 1) return lines;
    lines[last] = body + ' '.repeat(pad) + elapsed;
    return lines;
  }

  private elapsedText(): string | undefined {
    if (this.startedAt === undefined || this.startedAt <= 0) return undefined;
    return currentTheme.fg('textDim', formatTurnElapsed(this.now() - this.startedAt));
  }
}
