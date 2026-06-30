/**
 * Abstract AI provider interface.
 * All providers must implement generateReply().
 * This abstraction allows swapping Llama ↔ GPT-4 ↔ Gemini ↔ Claude
 * without touching any business logic.
 */
class AIProvider {
  getName() { throw new Error('AIProvider.getName() not implemented'); }

  /**
   * @param {object} params
   * @param {string} params.systemPrompt     - The full persona + style system prompt
   * @param {Array<{role:'user'|'assistant', content:string}>} params.messages - Recent conversation history
   * @param {number} [params.maxTokens=200]  - Max response tokens
   * @param {number} [params.temperature]    - Randomness 0-1
   * @returns {Promise<string>}              - Plain-text reply, never null
   */
  async generateReply(params) {
    throw new Error('AIProvider.generateReply() not implemented');
  }

  /**
   * Health check — called before attempting a generation.
   * Return false to gracefully degrade and skip AI for this request.
   * @returns {Promise<boolean>}
   */
  async isAvailable() { return true; }
}

module.exports = AIProvider;
