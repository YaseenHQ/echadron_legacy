/** Pure helpers for detecting and decoding UTF text files. */

export type UtfTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

export interface TextClassification {
  readonly isBinary: boolean;
  readonly encoding: UtfTextEncoding;
}

export const FS_BINARY_NONPRINTABLE_FRACTION = 0.3;

export interface TextEncodingDetection {
  readonly encoding: UtfTextEncoding;
  readonly seemsBinary: boolean;
}

export const ENCODING_DETECTION_SAMPLE_BYTES = 512;

const MIN_ZERO_BYTES_FOR_UTF16 = 2;

function sniffTextEncoding(sample: Uint8Array): TextEncodingDetection {
  // Always trust a BOM first.
  if (sample.length >= 2) {
    const b0 = sample[0]!;
    const b1 = sample[1]!;
    if (b0 === 0xfe && b1 === 0xff) return { encoding: 'utf-16be', seemsBinary: false };
    if (b0 === 0xff && b1 === 0xfe) return { encoding: 'utf-16le', seemsBinary: false };
    if (
      sample.length >= 3 &&
      b0 === 0xef &&
      b1 === 0xbb &&
      sample[2] === 0xbf
    ) {
      return { encoding: 'utf-8', seemsBinary: false };
    }
  }

  let zerosAtOdd = 0;
  let zerosAtEven = 0;
  const limit = Math.min(sample.length, ENCODING_DETECTION_SAMPLE_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 1) zerosAtOdd += 1;
    else zerosAtEven += 1;
  }

  if (zerosAtOdd === 0 && zerosAtEven === 0) {
    return { encoding: 'utf-8', seemsBinary: false };
  }
  if (zerosAtEven === 0 && zerosAtOdd >= MIN_ZERO_BYTES_FOR_UTF16) {
    return { encoding: 'utf-16le', seemsBinary: false };
  }
  if (zerosAtOdd === 0 && zerosAtEven >= MIN_ZERO_BYTES_FOR_UTF16) {
    return { encoding: 'utf-16be', seemsBinary: false };
  }
  return { encoding: 'utf-8', seemsBinary: true };
}

/**
 * Classify a byte sample once, so every file surface agrees on encoding and
 * binary status. UTF-8 multibyte text is decoded before counting controls;
 * treating continuation bytes as printable avoids misclassifying CJK/emoji
 * logs as binary.
 */
export function classifyTextSample(sample: Uint8Array): TextClassification {
  const sniffed = sniffTextEncoding(sample);
  if (sniffed.seemsBinary || sniffed.encoding !== 'utf-8') {
    return { isBinary: sniffed.seemsBinary, encoding: sniffed.encoding };
  }
  if (sample.includes(0)) {
    return { isBinary: true, encoding: 'utf-8' };
  }

  // A sample may end halfway through a valid UTF-8 sequence. Exclude only a
  // valid continuation tail before using a fatal decoder; an invalid lead or
  // continuation remains a binary signal.
  let end = sample.length;
  for (let i = Math.max(0, sample.length - 3); i < sample.length; i++) {
    const b = sample[i]!;
    const expected =
      b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    if (expected === 0 || i + expected <= sample.length) continue;
    let validPrefix = true;
    for (let j = i + 1; j < sample.length; j++) {
      const continuation = sample[j]!;
      if (continuation < 0x80 || continuation > 0xbf) {
        validPrefix = false;
        break;
      }
    }
    if (validPrefix) {
      end = i;
      break;
    }
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, end));
  } catch {
    return { isBinary: true, encoding: 'utf-8' };
  }

  let nonPrintable = 0;
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    total++;
    if (cp === 9 || cp === 10 || cp === 13) continue;
    if (cp < 32 || (cp >= 0x7f && cp <= 0x9f)) nonPrintable++;
  }
  return {
    isBinary: total > 0 && nonPrintable / total > FS_BINARY_NONPRINTABLE_FRACTION,
    encoding: 'utf-8',
  };
}

/** Detect UTF-8/UTF-16 and classify the sample for legacy callers. */
export function detectTextEncoding(sample: Uint8Array): TextEncodingDetection {
  const classification = classifyTextSample(sample);
  return { encoding: classification.encoding, seemsBinary: classification.isBinary };
}

export function decodeUtfText(bytes: Uint8Array, encoding: UtfTextEncoding): string {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes);
}
