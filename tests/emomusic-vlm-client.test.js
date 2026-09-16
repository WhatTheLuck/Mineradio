'use strict';

const assert = require('node:assert/strict');
const {
  EmomusicVlmClient,
  SILICONFLOW_CHAT_URL,
  DEFAULT_VLM_MODEL,
} = require('../desktop/emomusic-vlm-client');

async function run() {
  const previousKey = process.env.SILICONFLOW_API_KEY;
  delete process.env.SILICONFLOW_API_KEY;
  try {
  let captured;
  const client = new EmomusicVlmClient({
    credentialProvider: () => ({ apiKey: 'secure-test-key', baseUrl: 'https://api.siliconflow.cn/v1' }),
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        headers: { get: name => name === 'x-siliconcloud-trace-id' ? 'trace-test' : '' },
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            scores: {
              tension_relaxation: 0.2,
              anger_calmness: 0.4,
              irritation_leisure: 0.3,
              sadness_happiness: 0.6,
              sleepiness_energy: -0.2,
            },
            summary: 'visible neutral smile',
            prompts: [{ tag: 'warm piano', weight: 4.2, dimension: 'sadness_happiness' }],
          }) } }],
        }),
      };
    },
  });

  const result = await client.analyzeFrame('data:image/jpeg;base64,YQ==');
  assert.equal(result.ok, true);
  assert.equal(result.model, DEFAULT_VLM_MODEL);
  assert.equal(result.analysis.scores.sadness_happiness, 0.6);
  assert.deepEqual(result.analysis.prompts[0], { tag: 'warm piano', weight: 4.2, dimension: 'sadness_happiness' });
  assert.ok(result.analysis.prompts.length >= 5, 'missing provider tags are filled from the real five-dimensional VLM scores');
  assert.equal(captured.url, SILICONFLOW_CHAT_URL);
  assert.equal(captured.options.headers.authorization, 'Bearer secure-test-key');
  assert.equal(captured.body.messages[1].content[0].type, 'image_url');
  assert.equal(captured.body.messages[1].content[0].image_url.detail, 'low');
  assert.equal(captured.body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,YQ==');
  assert.equal(captured.body.response_format.type, 'json_object');
  assert.doesNotMatch(captured.body.messages[1].content[1].text, /tension_relaxation\"\s*:\s*-1(?:\.0)?/, 'the prompt does not anchor the model to an all-negative example');
  assert.match(captured.body.messages[0].content, /RGB face crop/, 'the system prompt states the actual image contract');
  assert.doesNotMatch(JSON.stringify(result), /secure-test-key/, 'the main process never returns the credential to the renderer');

  const allNegativeClient = new EmomusicVlmClient({
    credentialProvider: () => ({ apiKey: 'secure-test-key', baseUrl: 'https://api.siliconflow.cn/v1' }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '' },
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        scores: Object.fromEntries([
          'tension_relaxation', 'anger_calmness', 'irritation_leisure', 'sadness_happiness', 'sleepiness_energy',
        ].map(key => [key, -1])),
        prompts: [],
      }) } }] }),
    }),
  });
  const allNegativeResult = await allNegativeClient.analyzeFrame('data:image/jpeg;base64,YQ==');
  assert.equal(allNegativeResult.ok, false);
  assert.equal(allNegativeResult.error, 'VLM_SCORE_ALL_NEGATIVE', 'an all-negative contract violation is not reported as a successful VLM analysis');

  const missing = new EmomusicVlmClient({ credentialProvider: () => ({}) });
  const missingResult = await missing.analyzeFrame('data:image/jpeg;base64,YQ==');
  assert.equal(missingResult.error, 'SILICONFLOW_API_KEY_MISSING');

  const invalidResult = await client.analyzeFrame('https://example.com/image.jpg');
  assert.equal(invalidResult.error, 'VLM_IMAGE_INVALID');
  console.log('OK emomusic-vlm-client');
  } finally {
    if (previousKey) process.env.SILICONFLOW_API_KEY = previousKey;
    else delete process.env.SILICONFLOW_API_KEY;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
