import { visibleWidth } from '@yaseenhq/pi-tui';
import { describe, expect, it } from 'vitest';

import { ToastComponent } from '#/tui/components/chrome/toast';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

describe('ToastComponent', () => {
  it('right-aligns a single toast row', () => {
    const lines = new ToastComponent('Resumed session').render(40);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.replaceAll(ANSI_SGR, '').trim()).toBe('Resumed session');
    expect(visibleWidth(lines[0] ?? '')).toBe(40);
  });
});
