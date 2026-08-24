import { Readable } from 'node:stream';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { detectAcpProtocol } from '#/cli/sub/acp-protocol';
import { registerAcpV2Command } from '#/cli/sub/acp-v2';

describe('echadron acp-v2', () => {
  it('registers the ACP v2 compatibility command', () => {
    const program = new Command('echadron');
    registerAcpV2Command(program);

    const command = program.commands.find((entry) => entry.name() === 'acp-v2');
    expect(command).toBeDefined();
    expect(command?.description()).toContain('Agent Client Protocol');
  });

  it.each([
    [1, 'v1'],
    [2, 'v2'],
    [99, 'v2'],
  ] as const)('selects %s initialize requests as %s and replays the frame', async (version, protocol) => {
    const wire = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } })}\n`;
    const detected = await detectAcpProtocol(Readable.from([wire]));
    let replayed = '';
    for await (const chunk of detected.input as Readable) replayed += chunk.toString();

    expect(detected.protocol).toBe(protocol);
    expect(replayed).toBe(wire);
  });

  it('rejects a connection that does not begin with initialize', async () => {
    const input = Readable.from([
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/new', params: {} })}\n`,
    ]);
    await expect(detectAcpProtocol(input)).rejects.toThrow(/begin with an initialize request/);
  });

  it('replays bytes received after a chunk-split initialize frame', async () => {
    const initialize = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 2 },
    });
    const followup = `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new' })}\n`;
    const detected = await detectAcpProtocol(
      Readable.from([initialize.slice(0, 20), `${initialize.slice(20)}\n${followup}`]),
    );
    let replayed = '';
    for await (const chunk of detected.input as Readable) replayed += chunk.toString();

    expect(detected.protocol).toBe('v2');
    expect(replayed).toBe(`${initialize}\n${followup}`);
  });

  it('rejects an initialize frame larger than 1 MiB even when its newline is buffered', async () => {
    const padding = ' '.repeat(1024 * 1024);
    const wire = `${JSON.stringify({ method: 'initialize', params: { protocolVersion: 2, padding } })}\n`;
    await expect(detectAcpProtocol(Readable.from([wire]))).rejects.toThrow(/1 MiB frame limit/);
  });
});
