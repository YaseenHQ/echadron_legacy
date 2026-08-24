import { describe, expect, it, vi } from 'vitest';

import { createProgram } from '#/cli/commands';

describe('Echadron command identity', () => {
  it('exposes echadron with chad and maker aliases', () => {
    const program = createProgram('1.2.3', () => {}, () => {});
    expect(program.name()).toBe('echadron');
    expect(program.aliases()).toEqual(['chad', 'maker']);
  });

  it('routes update --models to the catalog refresh handler', async () => {
    const refresh = vi.fn(async () => {});
    const legacyUpgrade = vi.fn(async () => {});
    const program = createProgram('1.2.3', () => {}, () => {}, () => {}, legacyUpgrade, refresh);
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    await program.parseAsync(['node', 'maker', 'update', '--models']);

    expect(refresh).toHaveBeenCalledOnce();
    expect(legacyUpgrade).not.toHaveBeenCalled();
  });
});
