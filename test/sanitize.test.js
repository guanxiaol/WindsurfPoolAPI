import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText, PathSanitizeStream, sanitizeToolCall } from '../src/sanitize.js';

// Leaked Windsurf paths are redacted to the angle-bracketed marker
// `(internal path redacted)`. Shell / file APIs won't try to resolve that string,
// and downstream LLMs don't tokenize it as a path (see sanitize.js header
// for the history — ./tail and [internal] both caused read-loop regressions).

describe('sanitizeText', () => {
  it('redacts /tmp/windsurf-workspace paths', () => {
    assert.equal(sanitizeText('/tmp/windsurf-workspace/src/index.js'), '(internal path redacted)');
  });

  it('redacts bare /tmp/windsurf-workspace', () => {
    assert.equal(sanitizeText('/tmp/windsurf-workspace'), '(internal path redacted)');
  });

  it('redacts per-account workspace paths', () => {
    assert.equal(
      sanitizeText('/home/user/projects/workspace-abc12345/package.json'),
      '(internal path redacted)'
    );
  });

  it('redacts /opt/windsurf', () => {
    assert.equal(sanitizeText('/opt/windsurf/language_server'), '(internal path redacted)');
  });

  it('leaves normal text unchanged', () => {
    const text = 'Hello, this is a normal response.';
    assert.equal(sanitizeText(text), text);
  });

  it('handles multiple patterns in one string', () => {
    const input = 'Editing /tmp/windsurf-workspace/a.js and /opt/windsurf/bin';
    const result = sanitizeText(input);
    assert.equal(result, 'Editing (internal path redacted) and (internal path redacted)');
  });

  it('returns non-strings unchanged', () => {
    assert.equal(sanitizeText(null), null);
    assert.equal(sanitizeText(undefined), undefined);
    assert.equal(sanitizeText(''), '');
  });
});

describe('PathSanitizeStream', () => {
  it('sanitizes a complete path in one chunk', () => {
    const stream = new PathSanitizeStream();
    const out = stream.feed('/tmp/windsurf-workspace/file.js is here');
    const rest = stream.flush();
    assert.equal(out + rest, '(internal path redacted) is here');
  });

  it('handles path split across chunks', () => {
    const stream = new PathSanitizeStream();
    let result = '';
    result += stream.feed('Look at /tmp/windsurf');
    result += stream.feed('-workspace/config.yaml for details');
    result += stream.flush();
    assert.equal(result, 'Look at (internal path redacted) for details');
  });

  it('handles partial prefix at buffer end', () => {
    const stream = new PathSanitizeStream();
    let result = '';
    result += stream.feed('path is /tmp/win');
    result += stream.feed('dsurf-workspace/x.js done');
    result += stream.flush();
    assert.equal(result, 'path is (internal path redacted) done');
  });

  it('flushes clean text immediately', () => {
    const stream = new PathSanitizeStream();
    const out = stream.feed('Hello world ');
    assert.equal(out, 'Hello world ');
  });
});

describe('sanitizeToolCall', () => {
  it('sanitizes argumentsJson paths', () => {
    const tc = { name: 'Read', argumentsJson: '{"path":"/tmp/windsurf-workspace/f.js"}' };
    const result = sanitizeToolCall(tc);
    assert.equal(result.argumentsJson, '{"path":"(internal path redacted)"}');
  });

  it('sanitizes input object string values', () => {
    const tc = { name: 'Read', input: { file_path: '/home/user/projects/workspace-abc12345/src/x.ts' } };
    const result = sanitizeToolCall(tc);
    assert.equal(result.input.file_path, '(internal path redacted)');
  });

  it('returns null/undefined unchanged', () => {
    assert.equal(sanitizeToolCall(null), null);
    assert.equal(sanitizeToolCall(undefined), undefined);
  });
});
