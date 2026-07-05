export type MatchCandidate = { pattern: string; length: number };

export type LatticeDecodeOptions = { mode?: "viterbi" } | { mode: "beam"; beamWidth: number };

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

type DecodeRunOptions = { beamWidth?: number };

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

function pruneLayer(layer: Layer, beamWidth: number): void {
  if (layer.scores.size <= beamWidth) return;

  const kept = [...layer.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, beamWidth);
  const scores = new Map<string | null, number>();
  const back = new Map<string | null, Backpointer>();
  for (const [token, score] of kept) {
    scores.set(token, score);
    const ptr = layer.back.get(token);
    if (ptr) back.set(token, ptr);
  }
  layer.scores = scores;
  layer.back = back;
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
  n: number,
  i: number,
  prevToken: string | null,
  baseScore: number,
  candidates: MatchCandidate[],
  fromTrie: boolean,
  layers: Layer[],
  ctx: Pick<ViterbiContext, "transitionWeight" | "emissionScore">,
  beamWidth?: number,
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
    if (beamWidth !== undefined) pruneLayer(nextLayer, beamWidth);
  }
}

async function extendLayerAsync(
  n: number,
  i: number,
  prevToken: string | null,
  baseScore: number,
  candidates: MatchCandidate[],
  fromTrie: boolean,
  layers: Layer[],
  ctx: Pick<AsyncViterbiContext, "transitionWeight" | "emissionScore">,
  beamWidth?: number,
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
    if (beamWidth !== undefined) pruneLayer(nextLayer, beamWidth);
  }
}

function runBigramDecode(text: string, ctx: ViterbiContext, options?: DecodeRunOptions): string[] {
  const n = text.length;
  if (n === 0) return [];

  const beamWidth = options?.beamWidth;
  const layers: Layer[] = Array.from({ length: n + 1 }, createLayer);
  layers[0]?.scores.set(null, 0);

  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    if (!layer || layer.scores.size === 0) continue;
    if (beamWidth !== undefined) pruneLayer(layer, beamWidth);

    for (const [prevToken, baseScore] of layer.scores) {
      if (baseScore === Number.NEGATIVE_INFINITY) continue;

      let candidates = ctx.matchCandidates(text, i);
      const fromTrie = candidates.length > 0;
      if (!fromTrie) {
        const char = text[i];
        if (char === undefined) continue;
        candidates = [{ pattern: char, length: 1 }];
      }

      extendLayer(n, i, prevToken, baseScore, candidates, fromTrie, layers, ctx, beamWidth);
    }
  }

  return reconstructTokens(layers, n, text);
}

async function runBigramDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
  options?: DecodeRunOptions,
): Promise<string[]> {
  const n = text.length;
  if (n === 0) return [];

  const beamWidth = options?.beamWidth;
  const layers: Layer[] = Array.from({ length: n + 1 }, createLayer);
  layers[0]?.scores.set(null, 0);

  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    if (!layer || layer.scores.size === 0) continue;
    if (beamWidth !== undefined) pruneLayer(layer, beamWidth);

    for (const [prevToken, baseScore] of layer.scores) {
      if (baseScore === Number.NEGATIVE_INFINITY) continue;

      let candidates = await ctx.matchCandidates(text, i);
      const fromTrie = candidates.length > 0;
      if (!fromTrie) {
        const char = text[i];
        if (char === undefined) continue;
        candidates = [{ pattern: char, length: 1 }];
      }

      await extendLayerAsync(
        n,
        i,
        prevToken,
        baseScore,
        candidates,
        fromTrie,
        layers,
        ctx,
        beamWidth,
      );
    }
  }

  return reconstructTokens(layers, n, text);
}

export function decode(
  text: string,
  ctx: ViterbiContext,
  options?: LatticeDecodeOptions,
): string[] {
  if (options?.mode === "beam") {
    return beamDecode(text, ctx, options.beamWidth);
  }
  return viterbiDecode(text, ctx);
}

export async function decodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
  options?: LatticeDecodeOptions,
): Promise<string[]> {
  if (options?.mode === "beam") {
    return beamDecodeAsync(text, ctx, options.beamWidth);
  }
  return viterbiDecodeAsync(text, ctx);
}

export function viterbiDecode(text: string, ctx: ViterbiContext): string[] {
  return runBigramDecode(text, ctx);
}

export async function viterbiDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
): Promise<string[]> {
  return runBigramDecodeAsync(text, ctx);
}

export function beamDecode(text: string, ctx: ViterbiContext, beamWidth: number): string[] {
  return runBigramDecode(text, ctx, { beamWidth });
}

export async function beamDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
  beamWidth: number,
): Promise<string[]> {
  return runBigramDecodeAsync(text, ctx, { beamWidth });
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
