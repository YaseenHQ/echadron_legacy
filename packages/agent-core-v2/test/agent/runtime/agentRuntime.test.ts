import { describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';

import type { AgentContext } from '#/agent/agentContext/agentContext';
import type { AgentSpace } from '#/agent/agentContext/agentSpace';
import type { ServicesAccessor } from '#/_base/di/instantiation';
import {
  defineAgentRuntime,
  getAgentRuntimeDefinitionId,
} from '#/agent/runtime/agentRuntime';
import { AgentRuntimeSet } from '#/agent/runtime/agentRuntimeSet';

/**
 * Proves the actor-runtime foundation actually runs, not just typechecks: a
 * real xstate machine, registered as an agent-runtime contract, materialized
 * lazily on first `resolve()`, driven by `send()`, and read back through
 * `getLogicState()` — the same path every future migrated domain (todo, cron,
 * interaction, goal) will go through.
 */
describe('agent runtime foundation (xstate actor)', () => {
  const counterMachine = setup({
    types: {} as { context: { count: number }; events: { type: 'increment' } },
  }).createMachine({
    context: { count: 0 },
    on: {
      increment: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    },
  });

  interface CounterApi {
    increment(): void;
    count(): number;
  }

  const CounterRuntime = defineAgentRuntime<never, CounterApi>({
    id: 'test.counter',
    logic: counterMachine,
    createApi: (context) => ({
      increment: () => context.send({ type: 'increment' }),
      count: () => context.getLogicState<{ count: number }>().count,
    }),
  });

  function stubAccessor(): ServicesAccessor {
    return { get: () => { throw new Error('no services needed by this test'); } };
  }

  function stubAgent(): AgentContext {
    const space: AgentSpace = {
      use: () => { throw new Error('not exercised: non-durable runtime'); },
    };
    return { agentId: 'agent-1', generation: 0, space };
  }

  it('materializes lazily, runs the machine, and reflects state changes', () => {
    const set = new AgentRuntimeSet(stubAgent(), stubAccessor());
    set.apply({
      definition: CounterRuntime,
      generation: 1,
      active: true,
    });

    const counter = set.resolve(CounterRuntime);
    expect(counter.count()).toBe(0);

    counter.increment();
    counter.increment();
    expect(counter.count()).toBe(2);

    // Resolving again returns the SAME materialized instance, not a fresh one.
    expect(set.resolve(CounterRuntime)).toBe(counter);
  });

  it('rejects resolve() for a runtime that was never applied', () => {
    const set = new AgentRuntimeSet(stubAgent(), stubAccessor());
    expect(() => set.resolve(CounterRuntime)).toThrow(/unavailable/);
  });

  it('close() tears the runtime down; a later resolve on a fresh apply still works', async () => {
    const set = new AgentRuntimeSet(stubAgent(), stubAccessor());
    set.apply({ definition: CounterRuntime, generation: 1, active: true });
    set.resolve(CounterRuntime).increment();

    await set.close();

    expect(() => set.resolve(CounterRuntime)).toThrow(/is closed/);
  });

  it('getAgentRuntimeDefinitionId returns the declared id', () => {
    expect(getAgentRuntimeDefinitionId(CounterRuntime)).toBe('test.counter');
  });
});
