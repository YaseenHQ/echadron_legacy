import { describe, expect, it } from 'vitest';

import {
  classifyTextSample,
  decodeUtfText,
  detectTextEncoding,
  ENCODING_DETECTION_SAMPLE_BYTES,
} from '#/_base/text/encoding';
import { splitLinesKeepingTerminator } from '#/_base/text/line-endings';

function utf16Le(text: string): Buffer {
  return Buffer.from(text, 'utf16le');
}

function utf16Be(text: string): Buffer {
  const le = utf16Le(text);
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1]!;
    be[i + 1] = le[i]!;
  }
  return be;
}

describe('detectTextEncoding', () => {
  it('detects UTF BOMs', () => {
    expect(detectTextEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61])).encoding).toBe('utf-8');
    expect(detectTextEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00])).encoding).toBe('utf-16le');
    expect(detectTextEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61])).encoding).toBe('utf-16be');
  });

  it('detects BOM-less UTF-16 by zero-byte parity', () => {
    expect(detectTextEncoding(utf16Le('hello 你好\nsecond')).encoding).toBe('utf-16le');
    expect(detectTextEncoding(utf16Be('hello 你好\nsecond')).encoding).toBe('utf-16be');
  });

  it('rejects ambiguous zero bytes as binary', () => {
    expect(detectTextEncoding(Buffer.from([0x61, 0x00])).seemsBinary).toBe(true);
    expect(detectTextEncoding(Buffer.from([0x00, 0x00, 0x61, 0x62])).seemsBinary).toBe(true);
  });

  it('limits the heuristic to the leading sample window', () => {
    const sample = Buffer.alloc(ENCODING_DETECTION_SAMPLE_BYTES + 2, 0x61);
    sample[ENCODING_DETECTION_SAMPLE_BYTES + 1] = 0;
    expect(detectTextEncoding(sample)).toEqual({ encoding: 'utf-8', seemsBinary: true });
  });
});

describe('classifyTextSample', () => {
  it('classifies UTF-8 CJK and emoji text as text', () => {
    const sample = Buffer.from('2026-08-16 INFO 启动完成 ✅\n处理请求 🚀 成功\n'.repeat(20), 'utf8');
    expect(classifyTextSample(sample)).toEqual({ isBinary: false, encoding: 'utf-8' });
  });

  it('classifies invalid UTF-8 as binary', () => {
    expect(classifyTextSample(Buffer.from([0xd6, 0xd0, 0xc4, 0xe3, 0x31, 0x32]))).toEqual({
      isBinary: true,
      encoding: 'utf-8',
    });
  });

  it('tolerates a valid multibyte sequence truncated at the sample tail', () => {
    const sample = Buffer.concat([Buffer.from('日志记录\n', 'utf8'), Buffer.from([0xe4, 0xb8])]);
    expect(classifyTextSample(sample)).toEqual({ isBinary: false, encoding: 'utf-8' });
  });

  it('counts decoded control characters rather than UTF-8 continuation bytes', () => {
    const esc = String.fromCodePoint(0x1b);
    const sample = Buffer.from(`${esc}[32mINFO${esc}[0m 启动完成 ✅\n`.repeat(10), 'utf8');
    expect(classifyTextSample(sample)).toEqual({ isBinary: false, encoding: 'utf-8' });
  });
});

describe('decodeUtfText', () => {
  it('decodes UTF-16 and strips BOMs', () => {
    expect(decodeUtfText(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16Le('你好\nworld')]), 'utf-16le')).toBe(
      '你好\nworld',
    );
    expect(decodeUtfText(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16Be('你好\nworld')]), 'utf-16be')).toBe(
      '你好\nworld',
    );
  });
});

describe('splitLinesKeepingTerminator', () => {
  it('keeps terminators and unterminated tails', () => {
    expect(splitLinesKeepingTerminator('a\nb\n')).toEqual(['a\n', 'b\n']);
    expect(splitLinesKeepingTerminator('a\nb')).toEqual(['a\n', 'b']);
    expect(splitLinesKeepingTerminator('')).toEqual([]);
  });
});
