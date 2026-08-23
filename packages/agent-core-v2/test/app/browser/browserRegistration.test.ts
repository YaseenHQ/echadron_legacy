/**
 * The Browser tool is only reachable if the package entry imports it for its
 * registration side effect. Unit tests construct the class directly, so they
 * stay green even when nothing registers it — this case covers that gap.
 */
import { describe, expect, it } from 'vitest';

import '#/index';
import { getAgentToolContributions } from '#/agent/toolRegistry/toolContribution';

describe('Browser tool registration', () => {
  it('is contributed by the package entry', () => {
    const names = getAgentToolContributions().map((contribution) => contribution.options.name);
    expect(names).toContain('Browser');
  });
});
