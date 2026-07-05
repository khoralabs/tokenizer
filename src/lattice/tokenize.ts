export type MatchCandidate = { pattern: string; length: number };

export interface ViterbiContext {
  matchCandidates(text: string, offset: number): MatchCandidate[];
  transitionWeight(from: string | null, to: string): number;
  emissionScore(token: string): number;
}

export interface AsyncViterbiContext {
  matchCandidates(text: string, offset: number): Promise<MatchCandidate[]>;
  transitionWeight(from: string | null, to: string): Promise<number>;
  emissionScore(token: string): Promise<number>;
}

type Backpointer = { prevPos: number; token: string };

const FALLBACK_EMISSION = 0;

function reconstructTokens(
  text: string,
  n: number,
  dp: number[],
  back: (Backpointer | null)[],
): string[] {
  if (dp[n] === Number.NEGATIVE_INFINITY || back[n] === null) {
    return text.split("");
  }

  const tokens: string[] = [];
  let pos = n;
  while (pos > 0) {
    const step = back[pos];
    if (!step) break;
    tokens.unshift(step.token);
    pos = step.prevPos;
  }

  return tokens;
}

export function viterbiDecode(text: string, ctx: ViterbiContext): string[] {
  const n = text.length;
  if (n === 0) return [];

  const dp = new Array<number>(n + 1).fill(Number.NEGATIVE_INFINITY);
  const back = new Array<Backpointer | null>(n + 1).fill(null);
  const tokenAt = new Array<string | null>(n + 1).fill(null);
  dp[0] = 0;

  for (let i = 0; i < n; i++) {
    const baseScore = dp[i];
    if (baseScore === undefined || baseScore === Number.NEGATIVE_INFINITY) continue;

    let candidates = ctx.matchCandidates(text, i);
    const fromTrie = candidates.length > 0;
    if (!fromTrie) {
      const char = text[i];
      if (char === undefined) continue;
      candidates = [{ pattern: char, length: 1 }];
    }

    const prevToken: string | null = i === 0 ? null : (tokenAt[i] ?? null);

    for (const { pattern, length } of candidates) {
      const j = i + length;
      if (j > n) continue;

      const emission = fromTrie ? ctx.emissionScore(pattern) : FALLBACK_EMISSION;

      const transition = ctx.transitionWeight(prevToken, pattern);
      if (transition === Number.NEGATIVE_INFINITY) continue;

      const score = baseScore + emission + transition;
      const best = dp[j] ?? Number.NEGATIVE_INFINITY;
      if (score > best) {
        dp[j] = score;
        back[j] = { prevPos: i, token: pattern };
        tokenAt[j] = pattern;
      }
    }
  }

  return reconstructTokens(text, n, dp, back);
}

export async function viterbiDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
): Promise<string[]> {
  const n = text.length;
  if (n === 0) return [];

  const dp = new Array<number>(n + 1).fill(Number.NEGATIVE_INFINITY);
  const back = new Array<Backpointer | null>(n + 1).fill(null);
  const tokenAt = new Array<string | null>(n + 1).fill(null);
  dp[0] = 0;

  for (let i = 0; i < n; i++) {
    const baseScore = dp[i];
    if (baseScore === undefined || baseScore === Number.NEGATIVE_INFINITY) continue;

    let candidates = await ctx.matchCandidates(text, i);
    const fromTrie = candidates.length > 0;
    if (!fromTrie) {
      const char = text[i];
      if (char === undefined) continue;
      candidates = [{ pattern: char, length: 1 }];
    }

    const prevToken: string | null = i === 0 ? null : (tokenAt[i] ?? null);

    for (const { pattern, length } of candidates) {
      const j = i + length;
      if (j > n) continue;

      const emission = fromTrie ? await ctx.emissionScore(pattern) : FALLBACK_EMISSION;

      const transition = await ctx.transitionWeight(prevToken, pattern);
      if (transition === Number.NEGATIVE_INFINITY) continue;

      const score = baseScore + emission + transition;
      const best = dp[j] ?? Number.NEGATIVE_INFINITY;
      if (score > best) {
        dp[j] = score;
        back[j] = { prevPos: i, token: pattern };
        tokenAt[j] = pattern;
      }
    }
  }

  return reconstructTokens(text, n, dp, back);
}

export function createViterbiContext(deps: {
  matchCandidates(text: string, offset: number): MatchCandidate[];
  getTransitionWeight(from: string, to: string): number | null;
  getConfidence(pattern: string): number;
}): ViterbiContext {
  const emissionCache = new Map<string, number>();

  return {
    matchCandidates: deps.matchCandidates,
    transitionWeight(from, to) {
      if (from === null) return 0;
      const weight = deps.getTransitionWeight(from, to);
      if (weight === null || weight <= 0) return Number.NEGATIVE_INFINITY;
      return Math.log(weight);
    },
    emissionScore(token) {
      let score = emissionCache.get(token);
      if (score === undefined) {
        score = Math.log1p(deps.getConfidence(token));
        emissionCache.set(token, score);
      }
      return score;
    },
  };
}

export function createAsyncViterbiContext(deps: {
  matchCandidates(text: string, offset: number): Promise<MatchCandidate[]>;
  getTransitionWeight(from: string, to: string): Promise<number | null>;
  getConfidence(pattern: string): Promise<number>;
}): AsyncViterbiContext {
  const emissionCache = new Map<string, number>();

  return {
    matchCandidates: deps.matchCandidates,
    async transitionWeight(from, to) {
      if (from === null) return 0;
      const weight = await deps.getTransitionWeight(from, to);
      if (weight === null || weight <= 0) return Number.NEGATIVE_INFINITY;
      return Math.log(weight);
    },
    async emissionScore(token) {
      let score = emissionCache.get(token);
      if (score === undefined) {
        score = Math.log1p(await deps.getConfidence(token));
        emissionCache.set(token, score);
      }
      return score;
    },
  };
}
