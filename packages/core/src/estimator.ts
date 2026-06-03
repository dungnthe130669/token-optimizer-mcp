/**
 * Lightweight token estimator — no API call, no tiktoken dependency.
 * Approximation: ~3.5 chars/token for code, ~4.5 for prose.
 * Accurate to ±15% for Claude models.
 */
export function estimateTokens(text: string): number {
  const codeBlocks = (text.match(/```[\s\S]*?```/g) ?? []).join('');
  const prose = text.slice(0, text.length - codeBlocks.length);
  return Math.ceil(codeBlocks.length / 3.5 + prose.length / 4.5);
}

export function tokensToUsd(tokens: number, model = 'default', type: 'input' | 'output' = 'input'): number {
  const PRICES: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4':   { input: 3.00,  output: 15.00 },
    'claude-haiku-4':    { input: 0.25,  output: 1.25  },
    'gpt-4o':            { input: 2.50,  output: 10.00 },
    'gpt-4o-mini':       { input: 0.15,  output: 0.60  },
    default:             { input: 3.00,  output: 15.00 },
  };
  const price = PRICES[model] ?? PRICES.default;
  return (tokens / 1_000_000) * price[type];
}

export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
