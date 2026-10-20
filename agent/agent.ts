import { defineAgent } from 'eve';

export default defineAgent({
  model: 'openai/gpt-6-luna',
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: 80_000,
    maxOutputTokensPerSession: 12_000,
    maxTokenCostUsdPerSession: 0.25,
    sessionTimeoutMs: 24 * 60 * 60 * 1_000,
  },
});
