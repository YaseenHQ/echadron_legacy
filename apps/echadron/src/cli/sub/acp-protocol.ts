/**
 * ACP stdio protocol selection.
 *
 * ACP v1 and v2 share newline-delimited JSON-RPC framing but use different
 * schemas after initialization. This module reads exactly the first frame,
 * selects the highest compatible Echadron implementation, and replays every
 * consumed byte into the selected server so negotiation is transparent to
 * the client.
 */

import { PassThrough, type Readable } from 'node:stream';

const MAX_INITIAL_FRAME_BYTES = 1024 * 1024;

export type AcpProtocol = 'v1' | 'v2';

export interface DetectedAcpProtocol {
  readonly protocol: AcpProtocol;
  readonly input: NodeJS.ReadableStream;
}

export function detectAcpProtocol(input: NodeJS.ReadableStream): Promise<DetectedAcpProtocol> {
  const source = input as Readable;
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);

    const cleanup = (): void => {
      source.off('data', onData);
      source.off('end', onEnd);
      source.off('error', onError);
    };
    const fail = (error: Error): void => {
      cleanup();
      source.pause();
      reject(error);
    };
    const select = (frameEnd: number): void => {
      cleanup();
      source.pause();
      const line = buffered.subarray(0, frameEnd).toString('utf8').replace(/^\uFEFF/, '').trim();
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (error) {
        fail(new Error(`ACP initialization is not valid JSON: ${String(error)}`));
        return;
      }
      if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        fail(new Error('ACP connection must begin with a single initialize request.'));
        return;
      }
      const request = message as { readonly method?: unknown; readonly params?: unknown };
      if (request.method !== 'initialize' || typeof request.params !== 'object' || request.params === null) {
        fail(new Error('ACP connection must begin with an initialize request.'));
        return;
      }
      const protocolVersion = (request.params as { readonly protocolVersion?: unknown }).protocolVersion;
      if (typeof protocolVersion !== 'number' || !Number.isInteger(protocolVersion)) {
        fail(new Error('ACP initialize request must include an integer protocolVersion.'));
        return;
      }

      const replay = new PassThrough();
      replay.write(buffered);
      if (source.readableEnded) {
        replay.end();
      } else {
        source.pipe(replay);
        source.resume();
      }
      resolve({ protocol: protocolVersion >= 2 ? 'v2' : 'v1', input: replay });
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffered = Buffer.concat([buffered, bytes]);
      const frameEnd = buffered.indexOf(0x0a);
      if (frameEnd >= 0) {
        if (frameEnd > MAX_INITIAL_FRAME_BYTES) {
          fail(new Error('ACP initialize request exceeds the 1 MiB frame limit.'));
        } else {
          select(frameEnd);
        }
      } else if (buffered.length > MAX_INITIAL_FRAME_BYTES) {
        fail(new Error('ACP initialize request exceeds the 1 MiB frame limit.'));
      }
    };
    const onEnd = (): void => {
      if (buffered.length > 0) {
        select(buffered.length);
      } else {
        fail(new Error('ACP client closed stdin before initialize.'));
      }
    };
    const onError = (error: Error): void => {
      fail(error);
    };

    source.on('data', onData);
    source.once('end', onEnd);
    source.once('error', onError);
  });
}
