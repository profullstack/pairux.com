/** Pay as you go: provider list cost plus 10%. */
export const COPILOT_MARKUP = 1.1;

/** Prepaid top-ups sold through the CoinPay checkout (plan_payments.plan ids). */
export const COPILOT_TOPUPS = [
  { id: 'copilot_credit_5', priceUsd: 5 },
  { id: 'copilot_credit_20', priceUsd: 20 },
  { id: 'copilot_credit_50', priceUsd: 50 },
] as const;
export type CopilotTopupId = (typeof COPILOT_TOPUPS)[number]['id'];
export const copilotTopup = (id: string) => COPILOT_TOPUPS.find((one) => one.id === id) ?? null;

/** Claude list prices, USD per million tokens (input, output). */
const CLAUDE_PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
/** A model we have no price for is charged as the dearest one we use, never free. */
const UNKNOWN_PRICE: [number, number] = [4, 20];

/** Provider cost of one Claude call, in micro-USD. */
export function claudeCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const [input, output] = CLAUDE_PRICES[model] ?? UNKNOWN_PRICE;
  // $/MTok * tokens / 1e6 * 1e6 micros = $/MTok * tokens.
  return Math.ceil(input * inputTokens + output * outputTokens);
}

/** Provider cost of transcribing `samples` 16 kHz samples with ElevenLabs Scribe, in micro-USD. */
export function scribeCostMicros(samples: number): number {
  // Scribe: $0.22 per submitted hour = 220,000 micros per 57.6M samples.
  return samples > 0 ? Math.ceil((samples * 220_000) / 57_600_000) : 0;
}

/** What the owner pays for a provider cost: cost + 10%, rounded up to the micro-dollar. */
export function chargeMicros(costMicros: number): number {
  if (costMicros <= 0) return 0;
  return Math.ceil(costMicros * COPILOT_MARKUP);
}

export const formatUsd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
