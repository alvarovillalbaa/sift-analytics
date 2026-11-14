import { defineAgent } from 'eve';
import { siftSessionLimitReached } from './lib/usage-limits';

export default defineAgent({
  model: 'openai/gpt-6-luna',
  defaultTools: false,
  limits: {
    sessionUsage: siftSessionLimitReached,
    sessionTimeoutMs: 24 * 60 * 60 * 1_000,
  },
});
