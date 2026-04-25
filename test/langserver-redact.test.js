import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactProxyUrl } from '../src/langserver.js';

describe('redactProxyUrl', () => {
  it('redacts credentials from proxy URLs', () => {
    assert.equal(redactProxyUrl('http://user:secret@example.com:8080'), 'example.com:8080 (auth=true)');
  });

  it('shows host and port for unauthenticated proxies', () => {
    assert.equal(redactProxyUrl({ host: 'proxy.example.com', port: 1080 }), 'proxy.example.com:1080');
  });
});

