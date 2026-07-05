import type { IGraph } from "./graph";
import { createViterbiContext, decode, type LatticeDecodeOptions } from "./tokenize";

export function tokenizeWithLm(
  text: string,
  graph: IGraph,
  matchCandidates: (text: string, offset: number) => { pattern: string; length: number }[],
  options?: LatticeDecodeOptions,
): string[] {
  const ctx = createViterbiContext({
    matchCandidates,
    getTokenCount: (pattern) => graph.getTokenCount(pattern),
    getTotalEmissions: () => graph.getTotalEmissions(),
    getVocabSize: () => graph.getVocabSize(),
    getTransitionWeight: (from, to) => graph.getTransitionWeight(from, to),
    getOutgoingTotal: (from) => graph.getOutgoingTotal(from),
  });
  return decode(text, ctx, options);
}
