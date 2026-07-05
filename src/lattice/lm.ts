/** Add-k smoothing for unigram / bigram lattice decoding (SentencePiece-style). */
export const DEFAULT_LM_SMOOTHING = 0.1;

export type LmStats = {
  totalEmissions: number;
  vocabSize: number;
  smoothing: number;
};

export function unigramLogProb(
  count: number,
  { totalEmissions, vocabSize, smoothing }: LmStats,
): number {
  if (vocabSize <= 0) return Math.log(1 / smoothing);
  return Math.log((count + smoothing) / (totalEmissions + smoothing * vocabSize));
}

export function bigramLogProb(
  edgeWeight: number,
  fromTotal: number,
  { vocabSize, smoothing }: LmStats,
): number {
  if (vocabSize <= 0) return Math.log(1 / smoothing);
  return Math.log((edgeWeight + smoothing) / (fromTotal + smoothing * vocabSize));
}
