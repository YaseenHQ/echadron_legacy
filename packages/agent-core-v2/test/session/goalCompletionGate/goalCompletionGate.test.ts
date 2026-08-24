/**
 * Scenario: configured goal-completion command gates.
 * Responsibilities: skip empty command lists, fail on the first non-zero or
 * timed-out command, and parse the env command list.
 * Wiring: the pure runner plus the env parser; no Session host.
 * Run: `pnpm --filter @yaseenhq/agent-core-v2 exec vitest run test/session/goalCompletionGate/goalCompletionGate.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { buildGoalCompletionGateFeedback } from '#/agent/goal/completionGate';
import { parseGoalGateCommandsEnv } from '#/session/goalCompletionGate/configSection';
import { MAX_GATE_OUTPUT_CHARS, runGoalCompletionGates } from '#/session/goalCompletionGate/runGates';

const signal = new AbortController().signal;

describe('runGoalCompletionGates', () => {
  it('passes when no commands are configured', async () => {
    await expect(runGoalCompletionGates([], async () => {
      throw new Error('should not run');
    }, signal)).resolves.toEqual({ passed: true });
  });

  it('passes when every command exits 0', async () => {
    const ran: string[] = [];
    await expect(
      runGoalCompletionGates(
        ['npm test', 'npm run lint'],
        async (command) => {
          ran.push(command);
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
        signal,
      ),
    ).resolves.toEqual({ passed: true });
    expect(ran).toEqual(['npm test', 'npm run lint']);
  });

  it('fails closed on the first non-zero exit and keeps later commands unrun', async () => {
    const ran: string[] = [];
    const result = await runGoalCompletionGates(
      ['npm test', 'npm run lint'],
      async (command) => {
        ran.push(command);
        return { exitCode: 1, stdout: '', stderr: '1 failing' };
      },
      signal,
    );
    expect(ran).toEqual(['npm test']);
    expect(result).toEqual({
      passed: false,
      command: 'npm test',
      exitText: 'exited 1',
      output: '1 failing',
    });
    expect(buildGoalCompletionGateFeedback(result as Extract<typeof result, { passed: false }>)).toContain(
      'Configured completion gate failed',
    );
  });

  it('reports a timeout separately from a non-zero exit', async () => {
    await expect(
      runGoalCompletionGates(
        ['sleep 30'],
        async () => ({ exitCode: -1, stdout: '', stderr: '', timedOut: true }),
        signal,
      ),
    ).resolves.toMatchObject({
      passed: false,
      command: 'sleep 30',
      exitText: 'timed out',
    });
  });

  it('truncates long gate output', async () => {
    const result = await runGoalCompletionGates(
      ['npm test'],
      async () => ({
        exitCode: 1,
        stdout: 'x'.repeat(MAX_GATE_OUTPUT_CHARS + 20),
        stderr: '',
      }),
      signal,
    );
    expect(result.passed).toBe(false);
    if (result.passed) return;
    expect(result.output.endsWith('\n…(truncated)')).toBe(true);
    expect(result.output.length).toBe(MAX_GATE_OUTPUT_CHARS + '\n…(truncated)'.length);
  });
});

describe('parseGoalGateCommandsEnv', () => {
  it('splits semicolon and newline lists', () => {
    expect(parseGoalGateCommandsEnv('npm test; npm run lint')).toEqual(['npm test', 'npm run lint']);
    expect(parseGoalGateCommandsEnv('npm test\nnpm run lint')).toEqual(['npm test', 'npm run lint']);
  });

  it('accepts a JSON string array', () => {
    expect(parseGoalGateCommandsEnv('["npm test","cargo test"]')).toEqual(['npm test', 'cargo test']);
  });

  it('ignores blank and invalid values', () => {
    expect(parseGoalGateCommandsEnv('')).toBeUndefined();
    expect(parseGoalGateCommandsEnv('   ')).toBeUndefined();
    expect(parseGoalGateCommandsEnv('[1,2]')).toBeUndefined();
    expect(parseGoalGateCommandsEnv('["ok"')).toBeUndefined();
  });
});
