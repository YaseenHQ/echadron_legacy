/**
 * Parse xterm SGR mouse reports (`CSI < btn ; col ; row M/m`).
 * Coordinates are converted to 0-based cells.
 */

export interface SgrMouseEvent {
  readonly button: number;
  readonly col: number;
  readonly row: number;
  readonly press: boolean;
  readonly wheel: boolean;
}

const SGR_MOUSE = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/;

export function parseSgrMouse(data: string): SgrMouseEvent | undefined {
  const match = SGR_MOUSE.exec(data);
  if (match === undefined || match === null) return undefined;
  const button = Number(match[1]);
  const col = Number(match[2]);
  const row = Number(match[3]);
  if (!Number.isFinite(button) || !Number.isFinite(col) || !Number.isFinite(row)) {
    return undefined;
  }
  return {
    button: button & 3,
    col: Math.max(0, col - 1),
    row: Math.max(0, row - 1),
    press: match[4] === 'M',
    wheel: button === 64 || button === 65,
  };
}
