/**
 * Live turn-status elapsed text, after Grok Build's turn-status row
 * (`references/grok-build/.../views/turn_status.rs`).
 *
 * Tenths while the turn is still young so the line feels alive; compact
 * `XmYs` once it crosses a minute.
 */

export function formatTurnElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${String(minutes)}m${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h${String(minutes % 60).padStart(2, '0')}m`;
}
