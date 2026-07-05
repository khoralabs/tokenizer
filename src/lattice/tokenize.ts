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

/** Bigram backpointer: prevToken is the last-token state at prevPos. */
type Backpointer = { prevPos: number; prevToken: string | null; token: string };

type Layer = {
  scores: Map<string | null, number>;
  back: Map<string | null, Backpointer>;
};

const FALLBACK_EMISSION = 0;

function createLayer(): Layer {
  return { scores: new Map(), back: new Map() };
}

function updateLayer(layer: Layer, token: string, score: number, back: Backpointer): void {
  const best = layer.scores.get(token) ?? Number.NEGATIVE_INFINITY;
  if (score > best) {
    layer.scores.set(token, score);
    layer.back.set(token, back);
  }
}

function reconstructTokens(layers: Layer[], n: number, text: string): string[] {
  const end = layers[n];
  if (!end) return text.split("");

  let bestToken: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [token, score] of end.scores) {
    if (token === null) continue;
    if (score > bestScore) {
      bestScore = score;
      bestToken = token;
    }
  }

  if (bestToken === null) return text.split("");

  const tokens: string[] = [];
  let pos = n;
  let lastToken: string | null = bestToken;

  while (pos > 0 && lastToken !== null) {
    const layer = layers[pos];
    if (!layer) break;

    const step = layer.back.get(lastToken);
    if (!step) break;

    tokens.unshift(step.token);
    pos = step.prevPos;
    lastToken = step.prevToken;
  }

  return tokens;
}

function extendLayer(
  _text: string,
  n: number,
  i: number,
  prevToken: string | null,
  baseScore: number,
  candidates: MatchCandidate[],
  fromTrie: boolean,
  layers: Layer[],
  ctx: Pick<ViterbiContext, "transitionWeight" | "emissionScore">,
): void {
  for (const { pattern, length } of candidates) {
    const j = i + length;
    if (j > n) continue;

    const emission = fromTrie ? ctx.emissionScore(pattern) : FALLBACK_EMISSION;
    const transition = ctx.transitionWeight(prevToken, pattern);
    if (transition === Number.NEGATIVE_INFINITY) continue;

    const score = baseScore + emission + transition;
    const nextLayer = layers[j] ?? createLayer();
    layers[j] = nextLayer;
    updateLayer(nextLayer, pattern, score, { prevPos: i, prevToken, token: pattern });
  }
}

async function extendLayerAsync(
  _text: string,
  n: number,
  i: number,
  prevToken: string | null,
  baseScore: number,
  candidates: MatchCandidate[],
  fromTrie: boolean,
  layers: Layer[],
  ctx: Pick<AsyncViterbiContext, "transitionWeight" | "emissionScore">,
): Promise<void> {
  for (const { pattern, length } of candidates) {
    const j = i + length;
    if (j > n) continue;

    const emission = fromTrie ? await ctx.emissionScore(pattern) : FALLBACK_EMISSION;
    const transition = await ctx.transitionWeight(prevToken, pattern);
    if (transition === Number.NEGATIVE_INFINITY) continue;

    const score = baseScore + emission + transition;
    const nextLayer = layers[j] ?? createLayer();
    layers[j] = nextLayer;
    updateLayer(nextLayer, pattern, score, { prevPos: i, prevToken, token: pattern });
  }
}

export function viterbiDecode(text: string, ctx: ViterbiContext): string[] {
  const n = text.length;
  if (n === 0) return [];

  const layers: Layer[] = Array.from({ length: n + 1 }, createLayer);
  layers[0]?.scores.set(null, 0);

  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    if (!layer || layer.scores.size === 0) continue;

    for (const [prevToken, baseScore] of layer.scores) {
      if (baseScore === Number.NEGATIVE_INFINITY) continue;

      let candidates = ctx.matchCandidates(text, i);
      const fromTrie = candidates.length > 0;
      if (!fromTrie) {
        const char = text[i];
        if (char === undefined) continue;
        candidates = [{ pattern: char, length: 1 }];
      }

      extendLayer(text, n, i, prevToken, baseScore, candidates, fromTrie, layers, ctx);
    }
  }

  return reconstructTokens(layers, n, text);
}

export async function viterbiDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
): Promise<string[]> {
  const n = text.length;
  if (n === 0) return [];

  const layers: Layer[] = Array.from({ length: n + 1 }, createLayer);
  layers[0]?.scores.set(null, 0);

  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    if (!layer || layer.scores.size === 0) continue;

    for (const [prevToken, baseScore] of layer.scores) {
      if (baseScore === Number.NEGATIVE_INFINITY) continue;

      let candidates = await ctx.matchCandidates(text, i);
      const fromTrie = candidates.length > 0;
      if (!fromTrie) {
        const char = text[i];
        if (char === undefined) continue;
        candidates = [{ pattern: char, length: 1 }];
      }

      await extendLayerAsync(text, n, i, prevToken, baseScore, candidates, fromTrie, layers, ctx);
    }
  }

  return reconstructTokens(layers, n, text);
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
