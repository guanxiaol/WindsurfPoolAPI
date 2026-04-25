import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatStreamError, redactRequestLogText } from '../src/handlers/chat.js';
import { handleMessages } from '../src/handlers/messages.js';

function parseEvents(raw) {
  return raw.trim().split('\n\n').filter(Boolean).map(frame => {
    const lines = frame.split('\n');
    return {
      event: lines.find(line => line.startsWith('event: '))?.slice(7),
      data: JSON.parse(lines.find(line => line.startsWith('data: '))?.slice(6) || '{}'),
    };
  });
}

function fakeRes() {
  const listeners = new Map();
  return {
    body: '',
    writableEnded: false,
    write(chunk) { this.body += String(chunk); return true; },
    end(chunk) {
      if (chunk) this.write(chunk);
      this.writableEnded = true;
      for (const cb of listeners.get('close') || []) cb();
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(cb);
      return this;
    },
  };
}

describe('stream error protocol', () => {
  it('creates OpenAI-style structured stream errors', () => {
    assert.deepEqual(chatStreamError('boom', 'upstream_error', 'x'), {
      error: { message: 'boom', type: 'upstream_error', code: 'x' },
    });
  });

  it('redacts common secret patterns before debug request-body logging', () => {
    const redacted = redactRequestLogText('sk-1234567890abcdefghijklmnop test@example.com Cookie: session=abc eyJabc.def.ghi AKIAABCDEFGHIJKLMNOP');
    assert.doesNotMatch(redacted, /sk-1234567890/);
    assert.doesNotMatch(redacted, /test@example\.com/);
    assert.doesNotMatch(redacted, /session=abc/);
    assert.doesNotMatch(redacted, /eyJabc\.def\.ghi/);
    assert.doesNotMatch(redacted, /AKIAABCDEFGHIJKLMNOP/);
  });

  it('translates structured chat stream errors to Anthropic error events', async () => {
    const result = await handleMessages({ model: 'claude-sonnet-4.6', stream: true, messages: [{ role: 'user', content: 'hi' }] }, {
      async handleChatCompletions() {
        return {
          status: 200,
          stream: true,
          async handler(res) {
            res.end(`data: ${JSON.stringify(chatStreamError('boom', 'upstream_error'))}\n\n`);
          },
        };
      },
    });
    const res = fakeRes();
    await result.handler(res);
    const events = parseEvents(res.body);
    assert.equal(events[0].event, 'error');
    assert.equal(events[0].data.error.message, 'boom');
  });
});
