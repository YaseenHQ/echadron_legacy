/**
 * Scenario: fresh-agent goal-completion verification.
 * Responsibilities: verify inherited binding, tool-capable run orchestration, strict verdict parsing, cleanup, fail-closed errors, and private-memory invariants.
 * Wiring: real completion-review service with lifecycle, catalog, subagent, and log collaborators stubbed at Session scope.
 * Run: `pnpm --filter @yaseenhq/agent-core-v2 exec vitest run test/session/goalCompletionReview/goalCompletionReview.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import type { ServiceIdentifier, ServicesAccessor } from '#/_base/di/instantiation';
import { DisposableStore } from '#/_base/di/lifecycle';
import { type IAgentScopeHandle, LifecycleScope } from '#/_base/di/scope';
import { TestInstantiationService } from '#/_base/di/test';
import { Event } from '#/_base/event';
import { ILogService } from '#/_base/log/log';
import { IGoalCompletionReviewService } from '#/agent/goal/completionReview';
import { createMaxStepsExceededError } from '#/agent/loop/loop';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentProfileService } from '#/agent/profile/profile';
import type { GoalSnapshot } from '#/agent/goal/types';
import type { AgentProfile } from '#/app/agentProfileCatalog/agentProfileCatalog';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
  type CreateAgentOptions,
} from '#/session/agentLifecycle/agentLifecycle';
import { TruncatedTurnError } from '#/session/subagent/runAgentTurn';
import {
  SessionGoalCompletionReviewService,
  buildGoalCompletionReviewPrompt,
  parseGoalCompletionReview,
} from '#/session/goalCompletionReview/goalCompletionReviewService';
import { GOAL_COMPLETION_VERIFIER_PROFILE_NAME } from '#/session/goalCompletionReview/profile';
import { ISessionAgentProfileCatalog } from '#/session/sessionAgentProfileCatalog/sessionAgentProfileCatalog';
import { ISessionSubagentService } from '#/session/subagent/subagent';

import { stubLog } from '../../_base/log/stubs';

const goal: GoalSnapshot = {
  goalId: 'goal-1',
  objective: 'Ship <all> requested behavior',
  completionCriterion: 'Public checks pass',
  status: 'active',
  turnsUsed: 1,
  tokensUsed: 10,
  wallClockMs: 20,
  budget: {
    tokenBudget: null,
    turnBudget: null,
    wallClockBudgetMs: null,
    remainingTokens: null,
    remainingTurns: null,
    remainingWallClockMs: null,
    tokenBudgetReached: false,
    turnBudgetReached: false,
    wallClockBudgetReached: false,
    overBudget: false,
  },
};

function jsonSummary(
  achieved: boolean,
  gaps: readonly string[] = [],
  evidence?: string,
): { readonly summary: string } {
  return {
    summary: JSON.stringify({ achieved, gaps, ...(evidence === undefined ? {} : { evidence }) }),
  };
}

describe('SessionGoalCompletionReviewService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let created: CreateAgentOptions | undefined;
  let removed: string[];
  let runPrompts: string[];
  let runResults: Array<Promise<{ readonly summary: string }>>;
  let nextRunResult: number;
  let onRunCall: ((prompt: string, callIndex: number) => void) | undefined;
  let main: IAgentScopeHandle;
  let verifier: IAgentScopeHandle;
  let verifierProfileUpdates: Array<{ readonly activeToolNames: readonly string[] }>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    created = undefined;
    removed = [];
    runPrompts = [];
    nextRunResult = 0;
    verifierProfileUpdates = [];
    onRunCall = undefined;
    runResults = [
      Promise.resolve(
        jsonSummary(false, ['The shipped public path was not exercised.'], 'Helper-only evidence.'),
      ),
    ];
    main = agentHandle(MAIN_AGENT_ID, [
      [
        IAgentProfileService,
        {
          data: () => ({
            cwd: '/workspace',
            modelAlias: 'zai-coding-plan/glm-5.2',
            thinkingLevel: 'high',
          }),
          getEffectiveThinkingLevel: () => 'max',
        },
      ],
      [
        IAgentPermissionModeService,
        { mode: 'auto', setMode: () => undefined, onDidChangeMode: Event.None },
      ],
    ]);
    verifier = agentHandle('agent-7', [
      [
        IAgentPermissionModeService,
        {
          mode: 'ask',
          setMode: () => undefined,
          onDidChangeMode: Event.None,
        },
      ],
      [
        IAgentProfileService,
        {
          data: () => ({
            cwd: '/workspace',
            modelAlias: 'zai-coding-plan/glm-5.2',
            thinkingLevel: 'high',
            activeToolNames: ['Read', 'Glob', 'Grep', 'Bash'],
          }),
          getEffectiveThinkingLevel: () => 'max',
          update: vi.fn((changed: { readonly activeToolNames?: readonly string[] }) => {
            if (changed.activeToolNames !== undefined) {
              verifierProfileUpdates.push({ activeToolNames: changed.activeToolNames });
            }
          }),
        },
      ],
    ]);

    ix.stub(IAgentLifecycleService, {
      _serviceBrand: undefined,
      onDidCreate: Event.None as IAgentLifecycleService['onDidCreate'],
      onDidDispose: Event.None as IAgentLifecycleService['onDidDispose'],
      create: vi.fn(async (opts?: CreateAgentOptions) => {
        created = opts;
        return verifier;
      }),
      fork: vi.fn(),
      get: (agentId: string) => (agentId === MAIN_AGENT_ID ? main : undefined),
      list: () => [main],
      broadcastPermissionMode: () => undefined,
      remove: vi.fn(async (agentId: string) => {
        removed.push(agentId);
      }),
    } as unknown as IAgentLifecycleService);
    ix.stub(ISessionSubagentService, {
      _serviceBrand: undefined,
      hooks: {} as ISessionSubagentService['hooks'],
      onDidStopAgentTask: Event.None as ISessionSubagentService['onDidStopAgentTask'],
      run: vi.fn(async (agentId, request) => {
        const prompt = request.kind === 'prompt' ? request.prompt : '';
        const callIndex = nextRunResult;
        nextRunResult += 1;
        runPrompts.push(prompt);
        onRunCall?.(prompt, callIndex);
        const result = runResults[callIndex] ?? runResults.at(-1)!;
        return {
          agentId,
          turn: {} as never,
          completion: result,
        };
      }),
      notifyAgentTaskStopped: () => undefined,
    } as unknown as ISessionSubagentService);
    ix.stub(ISessionAgentProfileCatalog, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: Event.None as ISessionAgentProfileCatalog['onDidChange'],
      get: (name: string) =>
        name === GOAL_COMPLETION_VERIFIER_PROFILE_NAME ? verifierProfile() : undefined,
      getDefault: verifierProfile,
      list: () => [verifierProfile()],
      load: async () => undefined,
      reload: async () => undefined,
    } as unknown as ISessionAgentProfileCatalog);
    ix.stub(ILogService, stubLog());
    ix.set(
      IGoalCompletionReviewService,
      new SyncDescriptor(SessionGoalCompletionReviewService),
    );
  });

  afterEach(() => {
    disposables.dispose();
  });

  async function review(
    results: Array<Promise<{ readonly summary: string }>>,
    signal?: AbortSignal,
    reviewGoal: GoalSnapshot = goal,
  ): ReturnType<IGoalCompletionReviewService['review']> {
    runPrompts = [];
    nextRunResult = 0;
    verifierProfileUpdates = [];
    onRunCall = undefined;
    runResults = results;
    return ix.get(IGoalCompletionReviewService).review({
      goal: reviewGoal,
      signal: signal ?? new AbortController().signal,
    });
  }

  it('inherits the main binding, runs a fresh verifier, and removes it', async () => {
    const verdict = await review([
      Promise.resolve(
        jsonSummary(false, ['The shipped public path was not exercised.'], 'Helper-only evidence.'),
      ),
    ]);

    expect(created).toEqual({
      binding: {
        profile: GOAL_COMPLETION_VERIFIER_PROFILE_NAME,
        model: 'zai-coding-plan/glm-5.2',
        thinking: 'max',
        cwd: '/workspace',
      },
      labels: {
        parentAgentId: MAIN_AGENT_ID,
        purpose: 'goal-completion-review',
      },
    });
    expect(runPrompts).toHaveLength(1);
    expect(runPrompts[0]).toContain('Ship &lt;all&gt; requested behavior');
    expect(runPrompts[0]).toContain('Public checks pass');
    expect(verdict).toEqual({
      achieved: false,
      gaps: ['The shipped public path was not exercised.'],
      evidence: 'Helper-only evidence.',
    });
    expect(removed).toEqual(['agent-7']);
  });

  it('retries verdict formatting once on the same verifier and still removes it only once', async () => {
    const verdict = await review([
      Promise.resolve({ summary: 'Looks done, no issues found.' }),
      Promise.resolve(jsonSummary(false, ['The public path leaks a sentinel.'], 'dist/output.js')),
    ]);

    expect(runPrompts).toHaveLength(2);
    expect(runPrompts[1]).toContain('ONLY');
    expect(runPrompts[1]).toContain('strict JSON');
    expect(verifierProfileUpdates).toEqual([{ activeToolNames: [] }]);
    expect(verdict).toEqual({
      achieved: false,
      gaps: ['The public path leaks a sentinel.'],
      evidence: 'dist/output.js',
    });
    expect(removed).toEqual(['agent-7']);
  });

  it('fails closed when the format continuation is still malformed', async () => {
    const verdict = await review([
      Promise.resolve({ summary: 'I think it is done.' }),
      Promise.resolve({ summary: 'Still no JSON here.' }),
    ]);

    expect(runPrompts).toHaveLength(2);
    expect(verifierProfileUpdates).toEqual([{ activeToolNames: [] }]);
    expect(verdict).toMatchObject({ achieved: false });
    if (verdict.achieved) throw new Error('malformed retry should reject completion');
    expect(verdict.gaps[0]).toContain('verdict was malformed');
    expect(removed).toEqual(['agent-7']);
  });

  it('recovers from a step-ceiling exhaustion with one same-agent format continuation', async () => {
    const verdict = await review([
      Promise.reject(createMaxStepsExceededError(10)),
      Promise.resolve(jsonSummary(true)),
    ]);

    expect(runPrompts).toHaveLength(2);
    expect(verifierProfileUpdates).toEqual([{ activeToolNames: [] }]);
    expect(verdict).toEqual({ achieved: true });
    expect(removed).toEqual(['agent-7']);
  });

  it('recovers from output truncation with one same-agent format continuation', async () => {
    const verdict = await review([
      Promise.reject(new TruncatedTurnError()),
      Promise.resolve(jsonSummary(false, ['Incomplete output artifact.'], 'dist/main.js')),
    ]);

    expect(runPrompts).toHaveLength(2);
    expect(verifierProfileUpdates).toEqual([{ activeToolNames: [] }]);
    expect(verdict).toMatchObject({ achieved: false });
    if (verdict.achieved) throw new Error('truncation recovery should reflect the verdict');
    expect(verdict.gaps).toContain('Incomplete output artifact.');
    expect(removed).toEqual(['agent-7']);
  });

  it('does not run a second format continuation after recoverable exhaustion', async () => {
    const verdict = await review([
      Promise.reject(createMaxStepsExceededError(10)),
      Promise.resolve({ summary: 'Still no JSON here.' }),
    ]);

    expect(runPrompts).toHaveLength(2);
    expect(verifierProfileUpdates).toEqual([{ activeToolNames: [] }]);
    expect(verdict).toMatchObject({ achieved: false });
    if (verdict.achieved) throw new Error('malformed recovery should reject completion');
    expect(verdict.gaps[0]).toContain('verdict was malformed');
    expect(removed).toEqual(['agent-7']);
  });

  it('propagates cancellation before allocating a verifier', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      review([Promise.resolve(jsonSummary(true))], controller.signal),
    ).rejects.toThrow('cancelled');
    expect(created).toBeUndefined();
  });

  it('propagates cancellation during the format continuation without erasing a cached rejection', async () => {
    await review([Promise.resolve(jsonSummary(false, ['Gap A.'], 'evidence A'))]);

    const controller = new AbortController();
    let rejectFormatCompletion!: (error: unknown) => void;
    const formatCompletion = new Promise<{ readonly summary: string }>((_resolve, reject) => {
      rejectFormatCompletion = reject;
    });
    let formatStarted!: () => void;
    const formatStartedGate = new Promise<void>((resolve) => {
      formatStarted = resolve;
    });
    runPrompts = [];
    nextRunResult = 0;
    verifierProfileUpdates = [];
    onRunCall = (prompt) => {
      if (runPrompts.length === 2 && prompt.includes('ONLY')) formatStarted();
    };
    runResults = [Promise.resolve({ summary: 'done' }), formatCompletion];
    removed = [];
    const service = ix.get(IGoalCompletionReviewService);
    const pending = service.review({ goal, signal: controller.signal });

    await formatStartedGate;
    controller.abort(new Error('user cancelled'));
    rejectFormatCompletion(new Error('user cancelled'));
    await expect(pending).rejects.toThrow('user cancelled');

    expect(removed).toEqual(['agent-7']);
    expect(verifierProfileUpdates).toEqual([{ activeToolNames: [] }]);

    const third = await review([
      Promise.resolve({ summary: 'done' }),
      Promise.resolve(jsonSummary(true)),
    ]);
    expect(runPrompts[0]).toContain('Gap A.');
    expect(runPrompts[0]).toContain('prior_rejection');
    expect(runPrompts[0]).toContain('structural');
    expect(runPrompts[0]).toContain('transitive-contamination');
    expect(third).toEqual({ achieved: true });
  });

  it('propagates cancellation that races with a malformed format verdict', async () => {
    const controller = new AbortController();
    runPrompts = [];
    nextRunResult = 0;
    verifierProfileUpdates = [];
    runResults = [
      Promise.resolve({ summary: 'not json' }),
      Promise.resolve({ summary: 'still not json' }),
    ];
    onRunCall = (_prompt, callIndex) => {
      if (callIndex === 1) controller.abort(new Error('cancelled during parsing'));
    };

    const pending = ix.get(IGoalCompletionReviewService).review({
      goal,
      signal: controller.signal,
    });

    await expect(pending).rejects.toThrow('cancelled during parsing');
    expect(runPrompts).toHaveLength(2);
    expect(removed).toEqual(['agent-7']);
  });

  it('propagates cancellation before accepting a valid format verdict', async () => {
    await review([Promise.resolve(jsonSummary(false, ['Gap A.'], 'evidence A'))]);

    const controller = new AbortController();
    runPrompts = [];
    nextRunResult = 0;
    verifierProfileUpdates = [];
    runResults = [
      Promise.resolve({ summary: 'not json' }),
      Promise.resolve(jsonSummary(true)),
    ];
    onRunCall = (_prompt, callIndex) => {
      if (callIndex === 1) controller.abort(new Error('cancelled before acceptance'));
    };
    removed = [];

    const pending = ix.get(IGoalCompletionReviewService).review({
      goal,
      signal: controller.signal,
    });

    await expect(pending).rejects.toThrow('cancelled before acceptance');
    expect(runPrompts).toHaveLength(2);
    expect(removed).toEqual(['agent-7']);

    const next = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).toContain('Gap A.');
    expect(runPrompts[0]).toContain('prior_rejection');
    expect(next).toEqual({ achieved: true });
  });

  it('injects the prior gap only for the same goal and clears it on valid success', async () => {
    await review([Promise.resolve(jsonSummary(false, ['Gap A.']))]);

    const second = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).toContain('Gap A.');
    expect(runPrompts[0]).toContain('prior_rejection');
    expect(second).toEqual({ achieved: true });

    const third = await review([Promise.resolve(jsonSummary(false, ['Gap B.']))]);
    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(runPrompts[0]).not.toContain('Gap A.');
    if (third.achieved) throw new Error('third review should reject');
    expect(third.gaps).toContain('Gap B.');
  });

  it('does not inject the prior gap for a different goal id', async () => {
    await review([Promise.resolve(jsonSummary(false, ['Gap A.']))]);

    const otherGoal: GoalSnapshot = { ...goal, goalId: 'goal-other' };
    const verdict = await review([Promise.resolve(jsonSummary(true))], undefined, otherGoal);

    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(runPrompts[0]).not.toContain('Gap A.');
    expect(verdict).toEqual({ achieved: true });
  });

  it('does not cache an infrastructure failure as a concrete rejection', async () => {
    const first = await review([Promise.reject(new Error('provider unavailable'))]);
    expect(first).toMatchObject({ achieved: false });
    if (first.achieved) throw new Error('infra failure should reject');
    expect(first.gaps[0]).toContain('provider unavailable');

    const second = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(second).toEqual({ achieved: true });
  });

  it('does not cache a malformed verdict as a concrete rejection', async () => {
    const first = await review([
      Promise.resolve({ summary: 'not json' }),
      Promise.resolve({ summary: 'still not json' }),
    ]);
    expect(first).toMatchObject({ achieved: false });
    if (first.achieved) throw new Error('malformed should reject');
    expect(first.gaps[0]).toContain('verdict was malformed');

    const second = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(second).toEqual({ achieved: true });
  });

  it('an existing concrete rejection survives a two-malformed-response review', async () => {
    await review([Promise.resolve(jsonSummary(false, ['Gap A.'], 'evidence A'))]);

    const malformed = await review([
      Promise.resolve({ summary: 'not json' }),
      Promise.resolve({ summary: 'still not json' }),
    ]);
    expect(malformed).toMatchObject({ achieved: false });

    const third = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).toContain('Gap A.');
    expect(runPrompts[0]).toContain('prior_rejection');
    expect(third).toEqual({ achieved: true });
  });

  it('does not cache an empty-gap negative verdict as a concrete rejection', async () => {
    const first = await review([Promise.resolve(jsonSummary(false, []))]);
    expect(first).toMatchObject({ achieved: false });

    const second = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(second).toEqual({ achieved: true });
  });

  it('prevents a stale concurrent negative from overwriting the latest negative', async () => {
    const service = ix.get(IGoalCompletionReviewService);

    let releaseReview1!: () => void;
    const review1Gate = new Promise<void>((resolve) => {
      releaseReview1 = resolve;
    });
    let markReview1Started!: () => void;
    const review1Started = new Promise<void>((resolve) => {
      markReview1Started = resolve;
    });
    runPrompts = [];
    nextRunResult = 0;
    runResults = [
      review1Gate.then(() => jsonSummary(false, ['Stale gap from seq 1.'])),
      Promise.resolve(jsonSummary(false, ['Latest gap from seq 2.'])),
    ];
    onRunCall = (_prompt, callIndex) => {
      if (callIndex === 0) markReview1Started();
    };
    const review1 = service.review({ goal, signal: new AbortController().signal });

    await review1Started;
    await service.review({ goal, signal: new AbortController().signal });

    releaseReview1();
    await review1;

    await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).toContain('Latest gap from seq 2.');
    expect(runPrompts[0]).not.toContain('Stale gap from seq 1.');
  });

  it('prevents a stale concurrent success from clearing a newer negative', async () => {
    const service = ix.get(IGoalCompletionReviewService);

    let releaseReview1!: () => void;
    const review1Gate = new Promise<void>((resolve) => {
      releaseReview1 = resolve;
    });
    let markReview1Started!: () => void;
    const review1Started = new Promise<void>((resolve) => {
      markReview1Started = resolve;
    });
    runPrompts = [];
    nextRunResult = 0;
    runResults = [
      review1Gate.then(() => jsonSummary(true)),
      Promise.resolve(jsonSummary(false, ['Latest gap from seq 2.'])),
    ];
    onRunCall = (_prompt, callIndex) => {
      if (callIndex === 0) markReview1Started();
    };
    const review1 = service.review({ goal, signal: new AbortController().signal });

    await review1Started;
    await service.review({ goal, signal: new AbortController().signal });

    releaseReview1();
    await review1;

    await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).toContain('Latest gap from seq 2.');
    expect(runPrompts[0]).toContain('prior_rejection');
  });

  it('prevents a stale negative from repopulating after a newer success', async () => {
    const service = ix.get(IGoalCompletionReviewService);

    let releaseReview1!: () => void;
    const review1Gate = new Promise<void>((resolve) => {
      releaseReview1 = resolve;
    });
    let markReview1Started!: () => void;
    const review1Started = new Promise<void>((resolve) => {
      markReview1Started = resolve;
    });
    runPrompts = [];
    nextRunResult = 0;
    runResults = [
      review1Gate.then(() => jsonSummary(false, ['Stale gap from seq 1.'])),
      Promise.resolve(jsonSummary(true)),
    ];
    onRunCall = (_prompt, callIndex) => {
      if (callIndex === 0) markReview1Started();
    };
    const review1 = service.review({ goal, signal: new AbortController().signal });

    await review1Started;
    await service.review({ goal, signal: new AbortController().signal });

    releaseReview1();
    await review1;

    await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(runPrompts[0]).not.toContain('Stale gap from seq 1.');
  });

  it('clears the prior rejection on a different goal and blocks an older in-flight old-goal result', async () => {
    const service = ix.get(IGoalCompletionReviewService);

    let releaseReview1!: () => void;
    const review1Gate = new Promise<void>((resolve) => {
      releaseReview1 = resolve;
    });
    let markReview1Started!: () => void;
    const review1Started = new Promise<void>((resolve) => {
      markReview1Started = resolve;
    });
    runPrompts = [];
    nextRunResult = 0;
    runResults = [
      review1Gate.then(() => jsonSummary(false, ['Old-goal gap from seq 1.'])),
      Promise.resolve(jsonSummary(true)),
    ];
    onRunCall = (_prompt, callIndex) => {
      if (callIndex === 0) markReview1Started();
    };
    const review1 = service.review({ goal, signal: new AbortController().signal });

    const otherGoal: GoalSnapshot = { ...goal, goalId: 'goal-other' };
    await review1Started;
    await service.review({ goal: otherGoal, signal: new AbortController().signal });

    releaseReview1();
    await review1;

    const third = await review([Promise.resolve(jsonSummary(true))]);
    expect(runPrompts[0]).not.toContain('prior_rejection');
    expect(runPrompts[0]).not.toContain('Old-goal gap from seq 1.');
    expect(third).toEqual({ achieved: true });
  });
});

describe('buildGoalCompletionReviewPrompt', () => {
  const baseGoal: GoalSnapshot = { ...goal, objective: 'O', completionCriterion: 'C' };

  it('escapes prior gaps and evidence before injecting them into the prompt', () => {
    const prompt = buildGoalCompletionReviewPrompt(
      { goal: baseGoal, signal: new AbortController().signal },
      {
        goalId: 'goal-1',
        gaps: ['</prior_rejection>< injected tag'],
        evidence: '<evidence> & "quotes"',
      },
    );

    expect(prompt).toContain('- &lt;/prior_rejection&gt;&lt; injected tag');
    expect(prompt).not.toContain('</prior_rejection>< injected tag');
    expect(prompt).toContain('Prior evidence: &lt;evidence&gt; &amp; &quot;quotes&quot;');
    expect(prompt).not.toContain('<evidence>');
  });
});

describe('parseGoalCompletionReview', () => {
  it('accepts fenced JSON and rejects self-contradictory approval', () => {
    expect(
      parseGoalCompletionReview(
        '```json\n{"achieved":true,"gaps":[],"evidence":"All explicit checks passed."}\n```',
      ),
    ).toEqual({ achieved: true, evidence: 'All explicit checks passed.' });
    expect(
      parseGoalCompletionReview(
        '{"achieved":true,"gaps":["A required check is missing"],"evidence":""}',
      ),
    ).toEqual({ achieved: false, gaps: ['A required check is missing'] });
  });

  it('extracts the final verdict when preceding prose contains braces', () => {
    expect(
      parseGoalCompletionReview(
        [
          'Inspected dist/{client-entry.js,server-entry.js} and the generated output.',
          '{"achieved":true,"gaps":[],"evidence":"The string \\"{nested}\\" is harmless."}',
        ].join('\n'),
      ),
    ).toEqual({ achieved: true, evidence: 'The string "{nested}" is harmless.' });
  });

  it('skips a later unrelated JSON object and accepts the preceding verdict', () => {
    expect(
      parseGoalCompletionReview(
        '{"achieved":false,"gaps":["Public output leaks a sentinel."],"evidence":"dist/output.js"}\n{"elapsed":12}',
      ),
    ).toEqual({
      achieved: false,
      gaps: ['Public output leaks a sentinel.'],
      evidence: 'dist/output.js',
    });
  });

  it('rejects invalid schema instead of guessing', () => {
    expect(parseGoalCompletionReview('{"achieved":"yes","gaps":[]}')).toBeUndefined();
    expect(parseGoalCompletionReview('{"achieved":false,"gaps":[42]}')).toBeUndefined();
  });

  it('treats a raw negative with no non-empty gap as unparseable', () => {
    expect(parseGoalCompletionReview('{"achieved":false,"gaps":[]}')).toBeUndefined();
    expect(parseGoalCompletionReview('{"achieved":false,"gaps":["   "]}')).toBeUndefined();
  });
});

function verifierProfile(): AgentProfile {
  return {
    name: GOAL_COMPLETION_VERIFIER_PROFILE_NAME,
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    systemPrompt: () => 'verifier',
  };
}

function agentHandle(
  id: string,
  entries: readonly (readonly [ServiceIdentifier<unknown>, unknown])[],
): IAgentScopeHandle {
  const services = new Map(entries);
  const accessor: ServicesAccessor = {
    get: <T>(service: ServiceIdentifier<T>): T => {
      const value = services.get(service as ServiceIdentifier<unknown>);
      if (value === undefined) throw new Error(`Missing test service: ${String(service)}`);
      return value as T;
    },
  };
  return {
    id,
    kind: LifecycleScope.Agent,
    accessor,
    dispose: () => undefined,
  };
}
