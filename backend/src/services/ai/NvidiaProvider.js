'use strict';

const AIProvider = require('./AIProvider');

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const MODEL       = 'meta/llama-3.1-8b-instruct';
const TIMEOUT_MS  = 30_000;

class NvidiaProvider extends AIProvider {
  constructor(apiKey) {
    super();
    if (!apiKey) throw new Error('NvidiaProvider: NVIDIA_API_KEY is required');
    this._apiKey = apiKey;
    this._lastFailAt = 0;
    this._circuitOpen = false; // back-off after repeated failures
  }

  getName() { return 'nvidia/llama-3.1-8b-instruct'; }

  async isAvailable() {
    if (!this._circuitOpen) return true;
    // Re-attempt after 2 minutes
    if (Date.now() - this._lastFailAt > 120_000) {
      this._circuitOpen = false;
      return true;
    }
    return false;
  }

  async generateReply({ systemPrompt, messages, maxTokens = 200, temperature = 0.88 }) {
    const body = {
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: Math.min(maxTokens, 400),
      temperature: Math.max(0.1, Math.min(1.0, temperature)),
      top_p: 0.9,
      stream: false,
      frequency_penalty: 0.3, // reduce repetitive phrases
    };

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          `${NVIDIA_BASE}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this._apiKey}`,
            },
            body: JSON.stringify(body),
          },
          TIMEOUT_MS
        );

        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          if (resp.status === 429) {
            // Rate-limited by NVIDIA — back off and retry
            await sleep(attempt * 2000);
            lastErr = new Error(`NVIDIA 429: ${txt.slice(0, 200)}`);
            continue;
          }
          throw new Error(`NVIDIA HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        }

        const data = await resp.json();
        const reply = data?.choices?.[0]?.message?.content ?? '';
        if (!reply) throw new Error('NVIDIA returned empty reply');

        this._circuitOpen = false;
        return sanitizeReply(reply);

      } catch (err) {
        lastErr = err;
        if (attempt < 3) await sleep(attempt * 1500);
      }
    }

    // After 3 failures open circuit
    this._circuitOpen = true;
    this._lastFailAt = Date.now();
    throw lastErr;
  }
}

/* ── Helpers ── */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchWithTimeout(url, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); reject(new Error('NVIDIA request timed out')); }, timeoutMs);
    fetch(url, { ...options, signal: ctrl.signal })
      .then((r) => { clearTimeout(timer); resolve(r); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

function sanitizeReply(text) {
  return text
    .replace(/^(as an ai|i('m| am) an ai|i am a language model|i('m| am) claude|as a chatbot)[^.!?\n]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = NvidiaProvider;
