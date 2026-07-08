import { AhoCorasick } from "./aho-corasick";
import { bigramLogProb, DEFAULT_LM_SMOOTHING, type LmStats, unigramLogProb } from "./lm";
import {
  createAsyncViterbiContext,
  createViterbiContext,
  decode,
  decodeAsync,
  type LatticeDecodeOptions,
  type MatchCandidate,
} from "./tokenize";

/** Compiled decode index: Aho-Corasick vocabulary + precomputed LM scores. */
export interface ICompiledLattice {
  readonly patternCount: number;
  scan(text: string): MatchCandidate[][];
  emissionLogProb(token: string): number;
  transitionLogProb(from: string | null, to: string): number;
}

/** @deprecated Use ICompiledLattice */
export type CompiledLattice = ICompiledLattice;

export type LmTables = {
  emissionLogProb(token: string): number;
  transitionLogProb(from: string | null, to: string): number;
};

export type LmEdge = { from: string; to: string; weight: number };

export function buildLmTables(
  tokenCounts: ReadonlyMap<string, number>,
  edges: readonly LmEdge[],
): LmTables {
  let totalEmissions = 0;
  for (const count of tokenCounts.values()) totalEmissions += count;

  const lmStats: LmStats = {
    totalEmissions,
    vocabSize: tokenCounts.size,
    smoothing: DEFAULT_LM_SMOOTHING,
  };

  const emissionLogProb = new Map<string, number>();
  for (const [token, count] of tokenCounts) {
    emissionLogProb.set(token, unigramLogProb(count, lmStats));
  }
  const defaultEmission = unigramLogProb(0, lmStats);

  const outgoingTotals = new Map<string, number>();
  const transitionLogProb = new Map<string, number>();

  for (const { from, weight } of edges) {
    outgoingTotals.set(from, (outgoingTotals.get(from) ?? 0) + weight);
  }

  for (const { from, to, weight } of edges) {
    const fromTotal = outgoingTotals.get(from) ?? 0;
    transitionLogProb.set(transitionKey(from, to), bigramLogProb(weight, fromTotal, lmStats));
  }

  const defaultTransition = bigramLogProb(0, 0, lmStats);

  return {
    emissionLogProb(token) {
      return emissionLogProb.get(token) ?? defaultEmission;
    },
    transitionLogProb(from, to) {
      if (from === null) return 0;
      return transitionLogProb.get(transitionKey(from, to)) ?? defaultTransition;
    },
  };
}

export function compilePatterns(patterns: string[], lm: LmTables): ICompiledLattice {
  const matcher = new AhoCorasick(patterns);

  return {
    patternCount: patterns.length,
    scan: (text) => matcher.matchStarts(text),
    emissionLogProb: lm.emissionLogProb,
    transitionLogProb: lm.transitionLogProb,
  };
}

function transitionKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

export function tokenizeCompiled(
  text: string,
  lattice: ICompiledLattice,
  options?: LatticeDecodeOptions,
): string[] {
  const candidatesByStart = lattice.scan(text);
  const ctx = createViterbiContext({
    matchCandidates: (_input, offset) => candidatesByStart[offset] ?? [],
    getTokenCount: () => 0,
    getTotalEmissions: () => 0,
    getVocabSize: () => 0,
    getTransitionWeight: () => null,
    getOutgoingTotal: () => 0,
    emissionLogProb: lattice.emissionLogProb,
    transitionLogProb: lattice.transitionLogProb,
  });
  return decode(text, ctx, options);
}

export async function tokenizeCompiledAsync(
  text: string,
  lattice: ICompiledLattice,
  options?: LatticeDecodeOptions,
): Promise<string[]> {
  const candidatesByStart = lattice.scan(text);
  const ctx = createAsyncViterbiContext({
    matchCandidates: async (_input, offset) => candidatesByStart[offset] ?? [],
    getTokenCount: async () => 0,
    getTotalEmissions: async () => 0,
    getVocabSize: async () => 0,
    getTransitionWeight: async () => null,
    getOutgoingTotal: async () => 0,
    emissionLogProb: (token) => lattice.emissionLogProb(token),
    transitionLogProb: (from, to) => lattice.transitionLogProb(from, to),
  });
  return decodeAsync(text, ctx, options);
}
