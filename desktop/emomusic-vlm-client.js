'use strict';

const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const SILICONFLOW_CHAT_URL = SILICONFLOW_BASE_URL + '/chat/completions';
const DEFAULT_VLM_MODEL = 'Qwen/Qwen3-VL-8B-Instruct';
const MAX_IMAGE_DATA_URL_BYTES = 2 * 1024 * 1024;
const EMOTION_KEYS = [
  'tension_relaxation',
  'anger_calmness',
  'irritation_leisure',
  'sadness_happiness',
  'sleepiness_energy',
];
const EMOTION_PROMPT_FALLBACKS = {
  tension_relaxation: ['calm breathing', 'relaxed atmosphere'],
  anger_calmness: ['warm release', 'gentle rhythm'],
  irritation_leisure: ['smooth groove', 'light texture'],
  sadness_happiness: ['uplifting harmony', 'bright warmth'],
  sleepiness_energy: ['refreshing beat', 'vivid pulse'],
};

function text(value, max = 300) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function providerError(body) {
  return text(
    body && (
      body.message
      || body.error && (body.error.message || body.error.code || body.error.type)
      || body.code
    ),
    240
  );
}

function parseJsonObject(content) {
  if (Array.isArray(content)) content = content.map(part => part && typeof part === 'object' ? part.text || '' : part).join('');
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  const cleaned = text(content, 20000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch (error) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw error;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('VLM_SCORE_INVALID');
  const normalized = Math.abs(number) > 1 && Math.abs(number) <= 5 ? number / 5 : number;
  return Math.max(-1, Math.min(1, normalized));
}

function sanitizeEmotionAnalysis(value) {
  value = value && typeof value === 'object' ? value : {};
  const rawScores = value.scores || value.emotion_scores || {};
  const scores = {};
  EMOTION_KEYS.forEach(key => { scores[key] = normalizeScore(rawScores[key]); });
  const scoreValues = EMOTION_KEYS.map(key => scores[key]);
  if (scoreValues.every(score => score < 0)) {
    const error = new Error('VLM_SCORE_ALL_NEGATIVE');
    error.code = 'VLM_SCORE_ALL_NEGATIVE';
    throw error;
  }
  const sourcePrompts = Array.isArray(value.prompts)
    ? value.prompts
    : Array.isArray(value.music_prompt_tags) ? value.music_prompt_tags : [];
  const seen = new Set();
  const prompts = sourcePrompts.map((item, index) => {
    const source = item && typeof item === 'object' ? item : { tag: item };
    const tag = text(source.tag || source.name, 80);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return null;
    seen.add(key);
    return {
      tag,
      weight: Math.max(0, Math.min(5, Number.isFinite(Number(source.weight)) ? Number(source.weight) : 3)),
      dimension: EMOTION_KEYS.includes(source.dimension) ? source.dimension : EMOTION_KEYS[index % EMOTION_KEYS.length],
    };
  }).filter(Boolean).slice(0, 8);
  EMOTION_KEYS.forEach(key => {
    if (prompts.length >= 5 || prompts.some(item => item.dimension === key)) return;
    const score = scores[key];
    const tag = EMOTION_PROMPT_FALLBACKS[key][score >= 0 ? 1 : 0];
    if (seen.has(tag.toLowerCase())) return;
    seen.add(tag.toLowerCase());
    prompts.push({ tag, weight: Math.max(0, Math.min(5, 1 + Math.abs(score) * 4)), dimension: key });
  });
  return { scores, prompts, summary: text(value.summary || value.brief_emotion_summary, 500) };
}

class EmomusicVlmClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || null;
    this.credentialProvider = options.credentialProvider || null;
    this.inFlight = null;
  }

  readCredential() {
    const shared = this.credentialProvider ? this.credentialProvider() || {} : {};
    const sharedIsSiliconFlow = /^https:\/\/api\.siliconflow\.cn(?:\/v1)?\/?$/i.test(String(shared.baseUrl || '').trim());
    const apiKey = text(process.env.SILICONFLOW_API_KEY || (sharedIsSiliconFlow ? shared.apiKey : ''), 4096);
    return {
      apiKey,
      model: text(process.env.EMOMUSIC_VLM_MODEL || DEFAULT_VLM_MODEL, 200),
      source: process.env.SILICONFLOW_API_KEY ? 'environment' : (apiKey ? 'secure-store' : 'none'),
    };
  }

  status() {
    const credential = this.readCredential();
    return {
      ok: true,
      configured: !!credential.apiKey,
      model: credential.model,
      provider: 'SiliconFlow',
      source: credential.source,
    };
  }

  analyzeFrame(imageDataUrl) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this._analyzeFrame(imageDataUrl).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async _analyzeFrame(imageDataUrl) {
    const image = String(imageDataUrl || '');
    if (!/^data:image\/(?:jpeg|webp|png);base64,/i.test(image)) return { ok: false, error: 'VLM_IMAGE_INVALID' };
    if (Buffer.byteLength(image, 'utf8') > MAX_IMAGE_DATA_URL_BYTES) return { ok: false, error: 'VLM_IMAGE_TOO_LARGE' };
    const credential = this.readCredential();
    if (!credential.apiKey) return { ok: false, configured: false, error: 'SILICONFLOW_API_KEY_MISSING' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    let response;
    try {
      const request = this.fetchImpl || global.fetch;
      response = await request(SILICONFLOW_CHAT_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + credential.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: credential.model,
          temperature: 0.1,
          max_tokens: 700,
          stream: false,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Analyze only the visible, momentary facial expression in the provided RGB face crop. Do not infer identity, health, personality, ethnicity, or other sensitive traits. Return one strict JSON object and no markdown.',
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: image, detail: 'low' } },
                {
                  type: 'text',
                  text: 'Estimate the current visible affect for music adaptation. Return one JSON object with exactly these top-level fields: scores, summary, prompts. scores must contain exactly these numeric keys: tension_relaxation, anger_calmness, irritation_leisure, sadness_happiness, sleepiness_energy. Each score is continuous from -1 to 1: negative means the left-hand emotion, positive means the right-hand emotion, and 0 means neutral or visually uncertain. Use independent evidence for every dimension; never copy one value across all dimensions and never make all five scores negative. summary is one brief visual observation. prompts is an array of 5 to 8 corrective music objects, each with tag (short English text), weight (0 to 5), and dimension (one exact score key).',
                },
              ],
            },
          ],
        }),
      });
      const body = await response.json().catch(() => ({}));
      const traceId = text(response.headers && response.headers.get && response.headers.get('x-siliconcloud-trace-id'), 160);
      if (!response.ok) {
        return { ok: false, configured: true, status: response.status, error: 'VLM_HTTP_' + response.status, providerError: providerError(body), traceId };
      }
      const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      const analysis = sanitizeEmotionAnalysis(parseJsonObject(content));
      return { ok: true, configured: true, provider: 'SiliconFlow', model: credential.model, source: 'vlm', analysis, traceId };
    } catch (error) {
      const aborted = error && (error.name === 'AbortError' || controller.signal.aborted);
      return { ok: false, configured: true, status: response && response.status || 0, error: aborted ? 'VLM_TIMEOUT' : text(error && (error.code || error.message), 240) || 'VLM_REQUEST_FAILED' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  EmomusicVlmClient,
  sanitizeEmotionAnalysis,
  SILICONFLOW_CHAT_URL,
  DEFAULT_VLM_MODEL,
};
