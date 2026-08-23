/**
 * Fullscreen (alternate screen) dock layout.
 *
 * The root stack is built in `tui-state.ts`. These assertions pin the two
 * behaviours that are easy to break and invisible to a typecheck: an
 * underfilled transcript must sit against the dock rather than stranding at
 * the top of the screen, and shrink pressure must land on the transcript
 * rather than crushing the activity and todo rows.
 */

import { describe, expect, it } from 'vitest';

import { Container, ScrollView, Text, VStack } from '@yaseenhq/pi-tui';
import { TuiAltScreen } from '@yaseenhq/pi-tui';

import { VirtualTerminal } from '../../../../packages/pi-tui/test/virtual-terminal';

/** Mirrors the root stack `createTuiState` builds for the alternate screen. */
function buildAltScreen(options: {
  readonly columns: number;
  readonly rows: number;
  readonly transcriptLines: number;
}): { terminal: VirtualTerminal; tui: TuiAltScreen } {
  const terminal = new VirtualTerminal(options.columns, options.rows);
  const tui = new TuiAltScreen(terminal);

  const transcript = new Container();
  for (let i = 1; i <= options.transcriptLines; i += 1) {
    transcript.addChild(new Text(`transcript ${String(i)}`, 0, 0));
  }
  const scrollView = new ScrollView(transcript, {
    follow: 'end',
    primary: true,
    overscroll: 'chain',
    scrollbar: 'auto',
  });

  const activity = new Container();
  activity.addChild(new Text('ACTIVITY', 0, 0));
  const todo = new Container();
  todo.addChild(new Text('TODO', 0, 0));
  const editor = new Container();
  editor.addChild(new Text('EDITOR-TOP', 0, 0));
  editor.addChild(new Text('EDITOR-INPUT', 0, 0));
  editor.addChild(new Text('EDITOR-BOTTOM', 0, 0));
  const footer = new Container();
  footer.addChild(new Text('FOOTER', 0, 0));

  const dock = new VStack();
  dock.addChild(activity, { shrink: 1, minSize: 0 });
  dock.addChild(todo, { shrink: 1, minSize: 0 });
  dock.addChild(editor, { shrink: 1, minSize: 3 });
  dock.addChild(footer, { shrink: 1, minSize: 1 });

  const root = new VStack();
  const spacer = new Container();
  root.addChild(spacer, { basis: 0, grow: 1, shrink: 1, minSize: 0 });
  root.addChild(scrollView, { basis: 'auto', grow: 0, shrink: 1, minSize: 1 });
  root.addChild(dock, { basis: 'auto', grow: 0, shrink: 0.001, minSize: 1 });
  tui.setLayoutRoot(root);
  return { terminal, tui };
}

async function viewport(options: {
  readonly columns: number;
  readonly rows: number;
  readonly transcriptLines: number;
}): Promise<string[]> {
  const { terminal, tui } = buildAltScreen(options);
  tui.start();
  try {
    await terminal.waitForRender();
    return terminal.getViewport().map((line: string) => line.trimEnd());
  } finally {
    tui.stop();
  }
}

describe('fullscreen dock layout', () => {
  it('anchors a short transcript to the dock instead of the top of the screen', async () => {
    const lines = await viewport({ columns: 80, rows: 24, transcriptLines: 3 });

    // The regression this guards: without the growable spacer the transcript
    // sits at row 0 and leaves a dead void between it and the editor, so a
    // fresh session reads as a gap with text stranded above it.
    const firstTranscript = lines.findIndex((line) => line.includes('transcript 1'));
    const editorRow = lines.findIndex((line) => line.includes('EDITOR-INPUT'));
    expect(firstTranscript).toBeGreaterThan(0);
    expect(editorRow - firstTranscript).toBeLessThanOrEqual(8);
    for (const line of lines.slice(0, firstTranscript)) expect(line).toBe('');
  });

  it('fills the viewport and keeps follow-end when the transcript is long', async () => {
    const lines = await viewport({ columns: 80, rows: 24, transcriptLines: 60 });

    expect(lines[0]).toContain('transcript');
    // follow-end: the newest line is on screen, the oldest is scrolled away.
    expect(lines.some((line) => line.includes('transcript 60'))).toBe(true);
    expect(lines.some((line) => line.includes('transcript 1 '))).toBe(false);
  });

  it('spends height deficit on the transcript, never on the dock rows', async () => {
    // A naive evenly-weighted stack drops ACTIVITY and TODO first, which is
    // exactly the information a squeezed terminal most needs to keep.
    for (const rows of [24, 12, 8]) {
      const lines = await viewport({ columns: 80, rows, transcriptLines: 60 });
      const joined = lines.join('\n');
      expect(joined, `rows=${String(rows)}`).toContain('ACTIVITY');
      expect(joined, `rows=${String(rows)}`).toContain('TODO');
      expect(joined, `rows=${String(rows)}`).toContain('EDITOR-INPUT');
      expect(joined, `rows=${String(rows)}`).toContain('FOOTER');
    }
  });

  it('keeps the dock intact on a narrow terminal', async () => {
    const lines = await viewport({ columns: 34, rows: 12, transcriptLines: 20 });
    const joined = lines.join('\n');
    expect(joined).toContain('EDITOR-INPUT');
    expect(joined).toContain('FOOTER');
  });
});
