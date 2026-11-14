import type { TokenUsage } from 'eve';

export function siftSessionLimitReached({ window }: { window: Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'costUsd'> }) {
  return window.inputTokens >= 80_000 || window.outputTokens >= 12_000 || (window.costUsd ?? 0) >= 0.25;
}
