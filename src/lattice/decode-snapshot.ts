import type { Database } from "bun:sqlite";
import { bigramLogProb, DEFAULT_LM_SMOOTHING, type LmStats, unigramLogProb } from "./lm";
import { Trie as MemoryTrie } from "./memory/trie";
import { createViterbiContext, decode, type LatticeDecodeOptions } from "./tokenize";

export type DecodeSnapshot = {
  matchCandidates(text: string, offset: number): { pattern: string; length: number }[];
  emissionLogProb(token: string): number;
  transitionLogProb(from: string | null, to: string): number;
};

/** Bulk-load trie terminals + LM tables from SQLite for decode (no per-char SQL). */
export function loadSqliteDecodeSnapshot(db: Database): DecodeSnapshot {
  const patterns = db
    .query(
      `SELECT DISTINCT pattern AS pattern
       FROM trie_nodes
       WHERE terminal = 1 AND pattern IS NOT NULL`,
    )
    .all() as { pattern: string }[];

  const trie = new MemoryTrie();
  for (const { pattern } of patterns) {
    trie.merge(pattern, 0);
  }

  const tokenCounts = new Map<string, number>();
  const hasTokenCount = db
    .query("PRAGMA table_info(nodes)")
    .all()
    .some((column) => (column as { name: string }).name === "token_count");

  if (hasTokenCount) {
    const rows = db.query("SELECT token, token_count FROM nodes").all() as {
      token: string;
      token_count: number;
    }[];
    for (const row of rows) tokenCounts.set(row.token, row.token_count);
  }

  let totalEmissions = 0;
  for (const count of tokenCounts.values()) totalEmissions += count;
  const vocabSize = tokenCounts.size;

  const lmStats: LmStats = {
    totalEmissions,
    vocabSize,
    smoothing: DEFAULT_LM_SMOOTHING,
  };

  const emissionLogProb = new Map<string, number>();
  for (const [token, count] of tokenCounts) {
    emissionLogProb.set(token, unigramLogProb(count, lmStats));
  }
  const defaultEmission = unigramLogProb(0, lmStats);

  const outgoingTotals = new Map<string, number>();
  const transitionLogProb = new Map<string, number>();

  const edges = db
    .query(
      `SELECT f.token AS from_token, t.token AS to_token, e.weight AS weight
       FROM edges e
       JOIN nodes f ON f.id = e.from_id
       JOIN nodes t ON t.id = e.to_id`,
    )
    .all() as { from_token: string; to_token: string; weight: number }[];

  for (const { from_token, weight } of edges) {
    outgoingTotals.set(from_token, (outgoingTotals.get(from_token) ?? 0) + weight);
  }

  for (const { from_token, to_token, weight } of edges) {
    const fromTotal = outgoingTotals.get(from_token) ?? 0;
    transitionLogProb.set(
      transitionKey(from_token, to_token),
      bigramLogProb(weight, fromTotal, lmStats),
    );
  }

  const defaultTransition = bigramLogProb(0, 0, lmStats);

  return {
    matchCandidates: (text, offset) => trie.matchCandidates(text, offset),
    emissionLogProb(token) {
      return emissionLogProb.get(token) ?? defaultEmission;
    },
    transitionLogProb(from, to) {
      if (from === null) return 0;
      return transitionLogProb.get(transitionKey(from, to)) ?? defaultTransition;
    },
  };
}

function transitionKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

export function tokenizeWithSnapshot(
  text: string,
  snapshot: DecodeSnapshot,
  options?: LatticeDecodeOptions,
): string[] {
  const ctx = createViterbiContext({
    matchCandidates: snapshot.matchCandidates,
    getTokenCount: () => 0,
    getTotalEmissions: () => 0,
    getVocabSize: () => 0,
    getTransitionWeight: () => null,
    getOutgoingTotal: () => 0,
    emissionLogProb: snapshot.emissionLogProb,
    transitionLogProb: snapshot.transitionLogProb,
  });
  return decode(text, ctx, options);
}
