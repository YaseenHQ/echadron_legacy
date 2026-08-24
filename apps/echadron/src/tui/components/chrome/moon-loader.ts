import { Text, visibleWidth } from '@yaseenhq/pi-tui';
import type { TUI } from '@yaseenhq/pi-tui';

import {
  animationFrames,
  animationInterval,
  type UnicodeAnimationName,
} from '#/tui/constant/rendering';
import { currentTheme } from '#/tui/theme';

export class MoonLoader extends Text {
  private currentFrame = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ui: TUI;
  private frames: string[];
  private interval: number;
  private animationName: UnicodeAnimationName;
  private colorFn?: (s: string) => string;
  private label: string;
  private displayText = '';
  // Inline text used when the spinner is embedded into another line (e.g. the
  // agent-swarm progress status line). It intentionally excludes the tip: the
  // tip is only rendered when the loader sits on its own row in the activity
  // pane, otherwise it would get squeezed against whatever follows the inline
  // spinner (like the swarm progress bar).
  private inlineText = '';
  private tip: string = '';
  private availableWidth = 0;
  private customFramesKey: string | undefined;

  constructor(
    ui: TUI,
    colorFn?: (s: string) => string,
    label: string = '',
    animation: UnicodeAnimationName = 'braille',
  ) {
    super('', 1, 0);
    this.ui = ui;
    this.animationName = animation;
    this.frames = animationFrames(animation);
    this.interval = animationInterval(animation);
    this.colorFn = colorFn;
    this.label = label;
    this.start();
  }

  start(): void {
    this.stop();
    this.updateDisplay();
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.updateDisplay();
    }, this.interval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  setLabel(label: string): void {
    this.label = label;
    this.updateDisplay();
  }

  setColorFn(colorFn: ((s: string) => string) | undefined): void {
    this.colorFn = colorFn;
    this.updateDisplay();
  }

  setAnimation(animation: UnicodeAnimationName): void {
    if (this.animationName === animation && this.customFramesKey === undefined) return;
    this.animationName = animation;
    this.customFramesKey = undefined;
    this.applyFrames(animationFrames(animation), animationInterval(animation));
  }

  /**
   * Drive the loader from frames this app owns rather than a named library
   * animation — used by the activity face, whose frames depend on what the
   * agent is currently doing. `key` identifies the frame set so repeated
   * sets with the same mood do not restart the animation mid-cycle.
   */
  setCustomAnimation(key: string, frames: readonly string[], interval: number): void {
    if (this.customFramesKey === key) return;
    if (frames.length === 0) return;
    this.customFramesKey = key;
    this.applyFrames([...frames], interval);
  }

  private applyFrames(frames: string[], interval: number): void {
    this.frames = frames;
    this.interval = interval;
    this.currentFrame = 0;
    const wasRunning = this.intervalId !== null;
    if (wasRunning) this.start();
    else this.updateDisplay();
  }

  setTip(tip: string): void {
    this.tip = tip;
    this.updateDisplay();
  }

  setAvailableWidth(width: number): void {
    if (this.availableWidth === width) return;
    this.availableWidth = width;
    this.updateDisplay();
  }

  renderInline(): string {
    return this.inlineText;
  }

  private updateDisplay(): void {
    const frame = this.frames[this.currentFrame]!;
    const coloredFrame = this.colorFn ? this.colorFn(frame) : frame;
    const baseText = this.label ? `${coloredFrame} ${this.label}` : coloredFrame;
    this.inlineText = baseText;
    let text = baseText;
    if (this.tip) {
      const withTip = baseText + currentTheme.fg('textDim', this.tip);
      if (this.availableWidth === 0 || visibleWidth(withTip) <= this.availableWidth) {
        text = withTip;
      }
    }
    this.displayText = text;
    this.setText(this.displayText);
    this.ui.requestRender();
  }
}
