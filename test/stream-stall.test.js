import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldColdStall } from '../src/client.js';

describe('Cascade cold-stall classification', () => {
  it('does not classify thinking-only progress as cold stall', () => {
    assert.equal(shouldColdStall({
      elapsed: 60_000,
      coldStallMs: 30_000,
      sawActive: true,
      sawText: false,
      totalThinking: 128,
      toolCallCount: 0,
    }), false);
  });

  it('still classifies no-progress active streams as cold stall', () => {
    assert.equal(shouldColdStall({
      elapsed: 60_000,
      coldStallMs: 30_000,
      sawActive: true,
      sawText: false,
      totalThinking: 0,
      toolCallCount: 0,
    }), true);
  });
});

