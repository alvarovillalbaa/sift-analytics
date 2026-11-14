import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescript } from '../support/load-typescript.mjs';
const { siftSessionLimitReached: reached } = loadTypescript('agent/lib/usage-limits.ts', {});
test('input token budget holds at 80,000 without discounting cached tokens', () => { assert.equal(reached({ window: { inputTokens: 79_999, outputTokens: 0 } }), false); assert.equal(reached({ window: { inputTokens: 80_000, outputTokens: 0, cacheReadTokens: 80_000 } }), true); });
test('output token budget holds at 12,000', () => { assert.equal(reached({ window: { inputTokens: 0, outputTokens: 11_999 } }), false); assert.equal(reached({ window: { inputTokens: 0, outputTokens: 12_000 } }), true); });
test('reported cost budget holds at $0.25 and absent cost is unknown', () => { assert.equal(reached({ window: { inputTokens: 0, outputTokens: 0, costUsd: 0.249 } }), false); assert.equal(reached({ window: { inputTokens: 0, outputTokens: 0, costUsd: 0.25 } }), true); assert.equal(reached({ window: { inputTokens: 0, outputTokens: 0 } }), false); });
