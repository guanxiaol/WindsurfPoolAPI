import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldEmitNoAuthWarning } from '../src/auth.js';

describe('shouldEmitNoAuthWarning', () => {
  it('warns when unauthenticated service binds all interfaces', () => {
    assert.equal(shouldEmitNoAuthWarning('0.0.0.0', false), true);
    assert.equal(shouldEmitNoAuthWarning('::', false), true);
  });

  it('does not warn for localhost or configured auth', () => {
    assert.equal(shouldEmitNoAuthWarning('127.0.0.1', false), false);
    assert.equal(shouldEmitNoAuthWarning('0.0.0.0', true), false);
  });
});

