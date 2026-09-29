import { AhoCorasick } from "./aho-corasick";
import type { Atom, TerminalEntry } from "./atom";
import { atomsFromText } from "./atom";
import { bigramLogProb, DEFAULT_LM_SMOOTHING, type LmStats, unigramLogProb } from "./lm";
import {
  createAsyncViterbiContext,
  createViterbiContext,
  decode,
  decodeAsync,
  decodeIndexed,
  decodeIndexedAsync,
  type LatticeDecodeOptions,
  type MatchCandidate,
} from "./tokenize";

/** Compiled decode index: Aho-Corasick vocabulary + precomputed LM scores. */
export interface ICompiledLattice {
  readonly patternCount: number;
  /** Frozen terminal snapshot (pattern key + atom path used at compile). */
  readonly terminals: readonly TerminalEntry[];
  /** Pattern keys derived from `terminals`. */
  readonly patterns: readonly string[];
  /** Scan a character-atom source (UTF-16 code units). */
  scan(text: string): MatchCandidate[][];
  /** Scan an explicit atom source (symbol / byte feeds). */
  scanAtoms(source: readonly Atom[]): MatchCandidate[][];
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

export type LmCompileOptions = {
  smoothing?: number;
};

function resolveSmoothing(options?: LmCompileOptions): number {
  const smoothing = options?.smoothing ?? DEFAULT_LM_SMOOTHING;
  if (!Number.isFinite(smoothing) || smoothing <= 0) {
    throw new RangeError(`smoothing must be finite and > 0, got ${smoothing}`);
  }
  return smoothing;
}

export function buildLmTables(
  tokenCounts: ReadonlyMap<string, number>,
  edges: readonly LmEdge[],
  options?: LmCompileOptions,
): LmTables {
  let totalEmissions = 0;
  for (const count of tokenCounts.values()) totalEmissions += count;

  const lmStats: LmStats = {
    totalEmissions,
    vocabSize: tokenCounts.size,
    smoothing: resolveSmoothing(options),
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

  return {
    emissionLogProb(token) {
      return emissionLogProb.get(token) ?? defaultEmission;
    },
    transitionLogProb(from, to) {
      if (from === null) return 0;
      return (
        transitionLogProb.get(transitionKey(from, to)) ??
        bigramLogProb(0, outgoingTotals.get(from) ?? 0, lmStats)
      );
    },
  };
}

export function compilePatterns(
  terminals: readonly TerminalEntry[],
  lm: LmTables,
): ICompiledLattice {
  const entries = Object.freeze(
    terminals.map((entry) =>
      Object.freeze({ pattern: entry.pattern, atoms: Object.freeze([...entry.atoms]) }),
    ),
  );
  const patterns = Object.freeze(entries.map((e) => e.pattern));
  const matcher = new AhoCorasick(entries);

  return {
    patternCount: patterns.length,
    terminals: entries,
    patterns,
    scan: (text) => matcher.matchStarts(atomsFromText(text)),
    scanAtoms: (source) => matcher.matchStarts(source),
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

/** Grain-agnostic decode over an atom source; incomplete paths return `[]`. */
export function tokenizeCompiledAtoms(
  source: readonly Atom[],
  lattice: ICompiledLattice,
  options?: LatticeDecodeOptions,
): string[] {
  const byStart = lattice.scanAtoms(source);
  const result = decodeIndexed(
    {
      length: source.length,
      matchCandidates: (offset) => byStart[offset] ?? [],
      fallbackCandidate: (offset) => {
        const atom = source[offset];
        return atom === undefined ? null : { pattern: atom, length: 1 };
      },
      emissionScore: (token) => lattice.emissionLogProb(token),
      transitionWeight: (from, to) => lattice.transitionLogProb(from, to),
    },
    options,
  );
  return result.complete ? result.tokens : [];
}

export async function tokenizeCompiledAtomsAsync(
  source: readonly Atom[],
  lattice: ICompiledLattice,
  options?: LatticeDecodeOptions,
): Promise<string[]> {
  const byStart = lattice.scanAtoms(source);
  const result = await decodeIndexedAsync(
    {
      length: source.length,
      matchCandidates: async (offset) => byStart[offset] ?? [],
      fallbackCandidate: async (offset) => {
        const atom = source[offset];
        return atom === undefined ? null : { pattern: atom, length: 1 };
      },
      emissionScore: async (token) => lattice.emissionLogProb(token),
      transitionWeight: async (from, to) => lattice.transitionLogProb(from, to),
    },
    options,
  );
  return result.complete ? result.tokens : [];
}
