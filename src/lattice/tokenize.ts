import { bigramLogProb, DEFAULT_LM_SMOOTHING, type LmStats, unigramLogProb } from "./lm";

export type MatchCandidate = { pattern: string; length: number };

export type LatticeDecodeOptions =
  | { mode?: "viterbi"; useBigram?: boolean }
  | { mode: "beam"; beamWidth: number; useBigram?: boolean };

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

export type IndexedDecodeContext = {
  length: number;
  matchCandidates(offset: number): MatchCandidate[];
  fallbackCandidate(offset: number): MatchCandidate | null;
  transitionWeight(from: string | null, to: string): number;
  emissionScore(token: string): number;
};

export type AsyncIndexedDecodeContext = {
  length: number;
  matchCandidates(offset: number): Promise<MatchCandidate[]>;
  fallbackCandidate(offset: number): Promise<MatchCandidate | null>;
  transitionWeight(from: string | null, to: string): Promise<number>;
  emissionScore(token: string): Promise<number>;
};

export type DecodeStep = {
  token: string;
  start: number;
  end: number;
  emissionScore: number;
  transitionScore: number;
  cumulativeScore: number;
};

export type DecodeResult = {
  tokens: string[];
  steps: DecodeStep[];
  score: number;
  complete: boolean;
};

/** Bigram backpointer with score contributions for step reconstruction. */
type Backpointer = {
  prevPos: number;
  prevToken: string | null;
  token: string;
  emission: number;
  transition: number;
};

type Layer = {
  scores: Map<string | null, number>;
  back: Map<string | null, Backpointer>;
};

type DecodeRunOptions = { beamWidth?: number; useBigram?: boolean };

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

function assertPositiveIntegerBeamWidth(beamWidth: number): void {
  if (!Number.isInteger(beamWidth) || beamWidth <= 0) {
    throw new RangeError(`beamWidth must be a positive integer, got ${beamWidth}`);
  }
}

function assertValidCandidate(length: number, offset: number, n: number): void {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`candidate length must be a positive integer, got ${length}`);
  }
  if (offset + length > n) {
    throw new RangeError(
      `candidate length ${length} at offset ${offset} extends beyond source length ${n}`,
    );
  }
}

function incompleteResult(): DecodeResult {
  return {
    tokens: [],
    steps: [],
    score: Number.NEGATIVE_INFINITY,
    complete: false,
  };
}

function reconstructResult(layers: Layer[], n: number): DecodeResult {
  const end = layers[n];
  if (!end) return incompleteResult();

  let bestToken: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [token, score] of end.scores) {
    if (token === null) continue;
    if (score > bestScore) {
      bestScore = score;
      bestToken = token;
    }
  }

  if (bestToken === null) return incompleteResult();

  const steps: DecodeStep[] = [];
  let pos = n;
  let lastToken: string | null = bestToken;

  while (pos > 0 && lastToken !== null) {
    const layer = layers[pos];
    if (!layer) return incompleteResult();

    const step = layer.back.get(lastToken);
    if (!step) return incompleteResult();

    steps.unshift({
      token: step.token,
      start: step.prevPos,
      end: pos,
      emissionScore: step.emission,
      transitionScore: step.transition,
      cumulativeScore: layer.scores.get(lastToken) ?? Number.NEGATIVE_INFINITY,
    });
    pos = step.prevPos;
    lastToken = step.prevToken;
  }

  if (pos !== 0) return incompleteResult();

  return {
    tokens: steps.map((s) => s.token),
    steps,
    score: bestScore,
    complete: true,
  };
}

function resolveCandidates(
  matchCandidates: MatchCandidate[],
  fallback: MatchCandidate | null,
): MatchCandidate[] {
  if (matchCandidates.length > 0) return matchCandidates;
  return fallback ? [fallback] : [];
}

function extendIndexed(
  n: number,
  i: number,
  prevToken: string | null,
  baseScore: number,
  candidates: MatchCandidate[],
  layers: Layer[],
  emissionScore: (token: string) => number,
  transitionWeight: (from: string | null, to: string) => number,
  useBigram: boolean,
  beamWidth?: number,
): void {
  for (const { pattern, length } of candidates) {
    assertValidCandidate(length, i, n);
    const j = i + length;

    const emission = emissionScore(pattern);
    const transition = useBigram ? transitionWeight(prevToken, pattern) : 0;
    if (transition === Number.NEGATIVE_INFINITY) continue;

    const score = baseScore + emission + transition;
    const nextLayer = layers[j] ?? createLayer();
    layers[j] = nextLayer;
    updateLayer(nextLayer, pattern, score, {
      prevPos: i,
      prevToken,
      token: pattern,
      emission,
      transition,
    });
    if (beamWidth !== undefined) pruneLayer(nextLayer, beamWidth);
  }
}

async function extendIndexedAsync(
  n: number,
  i: number,
  prevToken: string | null,
  baseScore: number,
  candidates: MatchCandidate[],
  layers: Layer[],
  emissionScore: (token: string) => Promise<number>,
  transitionWeight: (from: string | null, to: string) => Promise<number>,
  useBigram: boolean,
  beamWidth?: number,
): Promise<void> {
  for (const { pattern, length } of candidates) {
    assertValidCandidate(length, i, n);
    const j = i + length;

    const emission = await emissionScore(pattern);
    const transition = useBigram ? await transitionWeight(prevToken, pattern) : 0;
    if (transition === Number.NEGATIVE_INFINITY) continue;

    const score = baseScore + emission + transition;
    const nextLayer = layers[j] ?? createLayer();
    layers[j] = nextLayer;
    updateLayer(nextLayer, pattern, score, {
      prevPos: i,
      prevToken,
      token: pattern,
      emission,
      transition,
    });
    if (beamWidth !== undefined) pruneLayer(nextLayer, beamWidth);
  }
}

function runIndexedDecode(context: IndexedDecodeContext, options?: DecodeRunOptions): DecodeResult {
  const n = context.length;
  if (n === 0) {
    return { tokens: [], steps: [], score: 0, complete: true };
  }

  const beamWidth = options?.beamWidth;
  const useBigram = options?.useBigram ?? true;
  const layers: Layer[] = Array.from({ length: n + 1 }, createLayer);
  layers[0]?.scores.set(null, 0);

  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    if (!layer || layer.scores.size === 0) continue;
    if (beamWidth !== undefined) pruneLayer(layer, beamWidth);

    const candidates = resolveCandidates(context.matchCandidates(i), context.fallbackCandidate(i));
    if (candidates.length === 0) continue;

    for (const [prevToken, baseScore] of layer.scores) {
      if (baseScore === Number.NEGATIVE_INFINITY) continue;

      extendIndexed(
        n,
        i,
        prevToken,
        baseScore,
        candidates,
        layers,
        context.emissionScore,
        context.transitionWeight,
        useBigram,
        beamWidth,
      );
    }
  }

  return reconstructResult(layers, n);
}

async function runIndexedDecodeAsync(
  context: AsyncIndexedDecodeContext,
  options?: DecodeRunOptions,
): Promise<DecodeResult> {
  const n = context.length;
  if (n === 0) {
    return { tokens: [], steps: [], score: 0, complete: true };
  }

  const beamWidth = options?.beamWidth;
  const useBigram = options?.useBigram ?? true;
  const layers: Layer[] = Array.from({ length: n + 1 }, createLayer);
  layers[0]?.scores.set(null, 0);

  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    if (!layer || layer.scores.size === 0) continue;
    if (beamWidth !== undefined) pruneLayer(layer, beamWidth);

    const candidates = resolveCandidates(
      await context.matchCandidates(i),
      await context.fallbackCandidate(i),
    );
    if (candidates.length === 0) continue;

    for (const [prevToken, baseScore] of layer.scores) {
      if (baseScore === Number.NEGATIVE_INFINITY) continue;

      await extendIndexedAsync(
        n,
        i,
        prevToken,
        baseScore,
        candidates,
        layers,
        context.emissionScore,
        context.transitionWeight,
        useBigram,
        beamWidth,
      );
    }
  }

  return reconstructResult(layers, n);
}

function decodeRunOptions(options?: LatticeDecodeOptions): DecodeRunOptions {
  if (options?.mode === "beam") {
    assertPositiveIntegerBeamWidth(options.beamWidth);
    return { beamWidth: options.beamWidth, useBigram: options.useBigram };
  }
  return { useBigram: options?.useBigram };
}

export function decodeIndexed(
  context: IndexedDecodeContext,
  options?: LatticeDecodeOptions,
): DecodeResult {
  return runIndexedDecode(context, decodeRunOptions(options));
}

export async function decodeIndexedAsync(
  context: AsyncIndexedDecodeContext,
  options?: LatticeDecodeOptions,
): Promise<DecodeResult> {
  return runIndexedDecodeAsync(context, decodeRunOptions(options));
}

function textIndexedContext(text: string, ctx: ViterbiContext): IndexedDecodeContext {
  return {
    length: text.length,
    matchCandidates: (offset) => ctx.matchCandidates(text, offset),
    fallbackCandidate: (offset) => {
      const ch = text[offset];
      return ch === undefined ? null : { pattern: ch, length: 1 };
    },
    transitionWeight: ctx.transitionWeight,
    emissionScore: ctx.emissionScore,
  };
}

function textIndexedContextAsync(
  text: string,
  ctx: AsyncViterbiContext,
): AsyncIndexedDecodeContext {
  return {
    length: text.length,
    matchCandidates: (offset) => ctx.matchCandidates(text, offset),
    fallbackCandidate: async (offset) => {
      const ch = text[offset];
      return ch === undefined ? null : { pattern: ch, length: 1 };
    },
    transitionWeight: ctx.transitionWeight,
    emissionScore: ctx.emissionScore,
  };
}

export function decodeDetailed(
  text: string,
  ctx: ViterbiContext,
  options?: LatticeDecodeOptions,
): DecodeResult {
  return decodeIndexed(textIndexedContext(text, ctx), options);
}

export async function decodeDetailedAsync(
  text: string,
  ctx: AsyncViterbiContext,
  options?: LatticeDecodeOptions,
): Promise<DecodeResult> {
  return decodeIndexedAsync(textIndexedContextAsync(text, ctx), options);
}

export function decode(
  text: string,
  ctx: ViterbiContext,
  options?: LatticeDecodeOptions,
): string[] {
  const result = decodeDetailed(text, ctx, options);
  if (result.complete) return result.tokens;
  return text.length === 0 ? [] : text.split("");
}

export async function decodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
  options?: LatticeDecodeOptions,
): Promise<string[]> {
  const result = await decodeDetailedAsync(text, ctx, options);
  if (result.complete) return result.tokens;
  return text.length === 0 ? [] : text.split("");
}

export function viterbiDecode(text: string, ctx: ViterbiContext): string[] {
  return decode(text, ctx);
}

export async function viterbiDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
): Promise<string[]> {
  return decodeAsync(text, ctx);
}

export function beamDecode(text: string, ctx: ViterbiContext, beamWidth: number): string[] {
  return decode(text, ctx, { mode: "beam", beamWidth });
}

export async function beamDecodeAsync(
  text: string,
  ctx: AsyncViterbiContext,
  beamWidth: number,
): Promise<string[]> {
  return decodeAsync(text, ctx, { mode: "beam", beamWidth });
}

export type LmDecodeDeps = {
  getTokenCount(pattern: string): number;
  getTotalEmissions(): number;
  getVocabSize(): number;
  getTransitionWeight(from: string, to: string): number | null;
  getOutgoingTotal(from: string): number;
  smoothing?: number;
  useBigram?: boolean;
  /** Precomputed scores; bypasses DB lookups when provided. */
  emissionLogProb?: (token: string) => number;
  transitionLogProb?: (from: string | null, to: string) => number;
};

function lmStats(deps: LmDecodeDeps): LmStats {
  return {
    totalEmissions: deps.getTotalEmissions(),
    vocabSize: deps.getVocabSize(),
    smoothing: deps.smoothing ?? DEFAULT_LM_SMOOTHING,
  };
}

export function createViterbiContext(
  deps: {
    matchCandidates(text: string, offset: number): MatchCandidate[];
  } & LmDecodeDeps,
): ViterbiContext {
  const emissionCache = new Map<string, number>();
  const outgoingCache = new Map<string, number>();
  const useBigram = deps.useBigram ?? true;
  const stats = () => lmStats(deps);
  const emissionFn = deps.emissionLogProb;
  const transitionFn = deps.transitionLogProb;

  return {
    matchCandidates: deps.matchCandidates,
    transitionWeight(from, to) {
      if (from === null || !useBigram) return 0;
      if (transitionFn) return transitionFn(from, to);
      const weight = deps.getTransitionWeight(from, to) ?? 0;
      let fromTotal = outgoingCache.get(from);
      if (fromTotal === undefined) {
        fromTotal = deps.getOutgoingTotal(from);
        outgoingCache.set(from, fromTotal);
      }
      return bigramLogProb(weight, fromTotal, stats());
    },
    emissionScore(token) {
      if (emissionFn) return emissionFn(token);
      let score = emissionCache.get(token);
      if (score === undefined) {
        score = unigramLogProb(deps.getTokenCount(token), stats());
        emissionCache.set(token, score);
      }
      return score;
    },
  };
}

export function createAsyncViterbiContext(
  deps: {
    matchCandidates(text: string, offset: number): Promise<MatchCandidate[]>;
  } & {
    getTokenCount(pattern: string): Promise<number>;
    getTotalEmissions(): Promise<number>;
    getVocabSize(): Promise<number>;
    getTransitionWeight(from: string, to: string): Promise<number | null>;
    getOutgoingTotal(from: string): Promise<number>;
    smoothing?: number;
    useBigram?: boolean;
    emissionLogProb?: (token: string) => number | Promise<number>;
    transitionLogProb?: (from: string | null, to: string) => number | Promise<number>;
  },
): AsyncViterbiContext {
  const emissionCache = new Map<string, number>();
  const outgoingCache = new Map<string, number>();
  const useBigram = deps.useBigram ?? true;
  let statsPromise: Promise<LmStats> | null = null;
  const emissionFn = deps.emissionLogProb;
  const transitionFn = deps.transitionLogProb;

  const stats = () => {
    if (!statsPromise) {
      statsPromise = Promise.all([deps.getTotalEmissions(), deps.getVocabSize()]).then(
        ([totalEmissions, vocabSize]) => ({
          totalEmissions,
          vocabSize,
          smoothing: deps.smoothing ?? DEFAULT_LM_SMOOTHING,
        }),
      );
    }
    return statsPromise;
  };

  return {
    matchCandidates: deps.matchCandidates,
    async transitionWeight(from, to) {
      if (from === null || !useBigram) return 0;
      if (transitionFn) return transitionFn(from, to);
      const weight = (await deps.getTransitionWeight(from, to)) ?? 0;
      let fromTotal = outgoingCache.get(from);
      if (fromTotal === undefined) {
        fromTotal = await deps.getOutgoingTotal(from);
        outgoingCache.set(from, fromTotal);
      }
      return bigramLogProb(weight, fromTotal, await stats());
    },
    async emissionScore(token) {
      if (emissionFn) return emissionFn(token);
      let score = emissionCache.get(token);
      if (score === undefined) {
        score = unigramLogProb(await deps.getTokenCount(token), await stats());
        emissionCache.set(token, score);
      }
      return score;
    },
  };
}
