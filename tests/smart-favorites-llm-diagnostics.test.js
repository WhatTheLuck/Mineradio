'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SmartFavoritesStore, apiBaseUrl, apiEndpoint, isRemoteHttpsUrl } = require('../desktop/smart-favorites-store');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: value => value.toString('utf8'),
};

test('standalone LLM response test reports DNS, first response, and total timing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-llm-test-'));
  try {
    const store = new SmartFavoritesStore({
      userDataPath: root,
      safeStorage: fakeSafeStorage,
      lookupImpl: async () => ({ address: '127.0.0.1', family: 4 }),
      fetchImpl: async (url, request) => {
        if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'small-model' }] }) };
        assert.equal(JSON.parse(request.body).max_tokens, 8);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
      },
    });
    store.configureLlm({ apiKey: 'secret', baseUrl: 'https://example.invalid/v1', model: 'small-model' });
    const result = await store.testLlmConnection();
    assert.equal(result.ok, true);
    assert.equal(result.reply, 'OK');
    assert.equal(result.stage, 'complete');
    assert.equal(typeof result.dnsMs, 'number');
    assert.equal(result.modelListed, true);
    assert.equal(typeof result.catalogMs, 'number');
    assert.equal(typeof result.headersMs, 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenAI-compatible URLs are normalized without duplicating chat paths', () => {
  assert.equal(apiBaseUrl('https://example.invalid/v1/chat/completions/'), 'https://example.invalid/v1');
  assert.equal(apiEndpoint('https://example.invalid/v1/models', 'chat/completions'), 'https://example.invalid/v1/chat/completions');
});

test('LLM configuration accepts public HTTPS APIs and rejects local proxies', () => {
  assert.equal(isRemoteHttpsUrl('https://api.siliconflow.cn/v1'), true);
  assert.equal(isRemoteHttpsUrl('https://api.openai.com/v1'), true);
  assert.equal(isRemoteHttpsUrl('http://127.0.0.1:11434/v1'), false);
  assert.equal(isRemoteHttpsUrl('https://192.168.1.8/v1'), false);
});

test('a missing model catalog does not block a working chat endpoint', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-llm-no-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const visited = [];
  const store = new SmartFavoritesStore({
    userDataPath: root,
    safeStorage: fakeSafeStorage,
    lookupImpl: async () => ({ address: '127.0.0.1', family: 4 }),
    fetchImpl: async url => {
      visited.push(url);
      if (url.endsWith('/models')) throw new Error('CATALOG_NOT_SUPPORTED');
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) };
    },
  });
  store.configureLlm({ apiKey: 'secret', baseUrl: 'https://example.invalid/v1/chat/completions', model: 'vision-model' });
  const result = await store.testLlmConnection();
  assert.equal(result.ok, true);
  assert.equal(result.modelListed, null);
  assert.deepEqual(visited, ['https://example.invalid/v1/models', 'https://example.invalid/v1/chat/completions']);
});

test('track analysis uses a bounded output budget and longer inference deadline', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'smart-favorites-store.js'), 'utf8');
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 90000\)/);
  assert.match(source, /Math\.min\(3072, Math\.max\(512, missing\.length \* 220\)\)/);
});

test('partial LLM batches are reported instead of being treated as complete', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-llm-partial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SmartFavoritesStore({
    userDataPath: root,
    safeStorage: fakeSafeStorage,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      const input = JSON.parse(request.messages[1].content);
      assert.equal(input.expectedResultCount, 2);
      assert.match(request.messages[0].content, /exactly one result for every input track/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: 'Result follows:\n```json\n{"results":[{"key":"one","genres":["jazz"]}]}\n```' } }],
        }),
      };
    },
  });
  store.configureLlm({ apiKey: 'secret', baseUrl: 'https://example.invalid/v1', model: 'small-model' });
  const result = await store.analyzeTracks([{ key: 'one', title: 'One' }, { key: 'two', title: 'Two' }], ['jazz']);
  assert.equal(result.ok, true);
  assert.equal(result.incomplete, true);
  assert.deepEqual(result.missingKeys, ['two']);
  assert.equal(result.finishReason, 'stop');
});
