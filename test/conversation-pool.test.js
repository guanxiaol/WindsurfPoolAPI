import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintBefore, fingerprintAfter, checkout, checkin, poolStats, poolClear } from '../src/conversation-pool.js';

describe('fingerprintBefore', () => {
  it('returns null for single-message conversations', () => {
    assert.equal(fingerprintBefore([{ role: 'user', content: 'hi' }]), null);
  });

  it('produces stable hash for same messages', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'how are you' },
    ];
    assert.equal(fingerprintBefore(msgs), fingerprintBefore(msgs));
  });

  it('changes when prior user messages change', () => {
    const msgs1 = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'next' },
    ];
    const msgs2 = [
      { role: 'user', content: 'different' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'next' },
    ];
    assert.notEqual(fingerprintBefore(msgs1), fingerprintBefore(msgs2));
  });

  it('ignores assistant message content changes', () => {
    const msgs1 = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'response A' },
      { role: 'user', content: 'next' },
    ];
    const msgs2 = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'completely different response' },
      { role: 'user', content: 'next' },
    ];
    assert.equal(fingerprintBefore(msgs1), fingerprintBefore(msgs2));
  });

  it('strips system-reminder meta tags before hashing', () => {
    const msgs1 = [
      { role: 'user', content: 'hello <system-reminder>some state</system-reminder>' },
      { role: 'user', content: 'next' },
    ];
    const msgs2 = [
      { role: 'user', content: 'hello <system-reminder>different state</system-reminder>' },
      { role: 'user', content: 'next' },
    ];
    assert.equal(fingerprintBefore(msgs1), fingerprintBefore(msgs2));
  });

  it('includes model key in fingerprint', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'next' },
    ];
    assert.notEqual(
      fingerprintBefore(msgs, 'gpt-4o'),
      fingerprintBefore(msgs, 'claude-4.5-sonnet')
    );
  });
});

describe('fingerprintAfter', () => {
  it('produces a hash for single-message conversations', () => {
    const fp = fingerprintAfter([{ role: 'user', content: 'hi' }]);
    assert.ok(typeof fp === 'string' && fp.length === 64);
  });

  it('differs from fingerprintBefore on same messages', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'next' },
    ];
    assert.notEqual(fingerprintBefore(msgs), fingerprintAfter(msgs));
  });
});

describe('checkout / checkin', () => {
  it('isolates identical prompt fingerprints by caller', () => {
    poolClear();
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'next' },
    ];
    const fpA = fingerprintBefore(msgs, 'claude-opus-4.6', 'caller-a');
    const fpB = fingerprintBefore(msgs, 'claude-opus-4.6', 'caller-b');
    assert.notEqual(fpA, fpB);
    checkin(fpA, { cascadeId: 'c-a', sessionId: 's-a', lsPort: 42100, apiKey: 'key-a' }, 'caller-a');
    assert.equal(checkout(fpB, 'caller-b'), null);
    assert.equal(checkout(fpA, 'caller-a')?.cascadeId, 'c-a');
  });

  it('reuses for the same caller and prompt trajectory', () => {
    poolClear();
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'next' },
    ];
    const fp = fingerprintBefore(msgs, 'claude-opus-4.6', 'caller-a');
    checkin(fp, { cascadeId: 'c-same', sessionId: 's-same', lsPort: 42100, apiKey: 'key-a' }, 'caller-a');
    assert.equal(checkout(fp, 'caller-a')?.cascadeId, 'c-same');
  });

  it('returns null on miss', () => {
    assert.equal(checkout('nonexistent-fp'), null);
  });

  it('round-trips an entry', () => {
    const entry = { cascadeId: 'c1', sessionId: 's1', lsPort: 42100, apiKey: 'key1' };
    checkin('fp-test-1', entry);
    const got = checkout('fp-test-1');
    assert.ok(got);
    assert.equal(got.cascadeId, 'c1');
    assert.equal(got.lsPort, 42100);
  });

  it('removes entry on checkout (mutual exclusion)', () => {
    const entry = { cascadeId: 'c2', sessionId: 's2', lsPort: 42100, apiKey: 'key2' };
    checkin('fp-test-2', entry);
    checkout('fp-test-2');
    assert.equal(checkout('fp-test-2'), null);
  });
});

describe('poolStats', () => {
  it('returns stats object with expected keys', () => {
    const s = poolStats();
    assert.ok('size' in s);
    assert.ok('hits' in s);
    assert.ok('misses' in s);
    assert.ok('hitRate' in s);
  });
});
