import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abortActiveSse, activeSseCount, registerSseController } from '../src/sse-registry.js';

describe('SSE controller registry', () => {
  it('aborts registered controllers and unregisters cleanly', () => {
    abortActiveSse();
    let reason = '';
    const unregister = registerSseController({ abort: (r) => { reason = r; } });
    assert.equal(activeSseCount(), 1);
    assert.equal(abortActiveSse('server shutting down'), 1);
    assert.equal(reason, 'server shutting down');
    unregister();
    assert.equal(activeSseCount(), 0);
  });
});

