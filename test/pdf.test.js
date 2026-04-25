import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { tryExtractPdf } from '../src/pdf.js';

describe('PDF extraction safety limits', () => {
  it('falls back when a compressed stream expands beyond the per-stream limit', () => {
    const inflated = Buffer.alloc(6 * 1024 * 1024, 0x20);
    const compressed = deflateSync(inflated);
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const result = tryExtractPdf(pdf.toString('base64'));
    assert.equal(result.text, 'PDF 内容无法提取');
  });
});

