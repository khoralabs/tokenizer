/**
 * Interface for a directed graph that stores token transitions (Markov chain).
 */
export interface IGraph {
  /**
   * Gets or creates a node for a token.
   */
  getOrCreateNode(pattern: string): number;

  /**
   * Adds a transition between two tokens (creates nodes if needed).
   * @param from - Source token
   * @param to - Destination token
   * @returns Object containing the from and to node IDs
   */
  merge(from: string, to: string, delta?: number): { from_id: number; to_id: number };

  /**
   * Bulk transition insertion for large sequences.
   * @param pairs - Array of [from, to] token pairs
   * @returns Array of objects containing from and to node IDs
   */
  mergeBatch(pairs: [string, string][]): { from_id: number; to_id: number }[];

  /**
   * Retrieves all outgoing transitions for a token.
   * @param from - The source token
   * @returns Array of transitions with weights
   */
  getNext(from: string): { to: string; weight: number }[];

  /**
   * Returns top N tokens by hub score using the configured scoring algorithm.
   * @param limit - Number of tokens to return (default 10)
   * @returns Array of tokens with confidences
   */
  getTopTokens(limit?: number): { pattern: string; confidence: number }[];

  /** All pattern strings stored in the graph. */
  listPatterns(): string[];

  /** Outgoing edge weight between two patterns, or null if absent. */
  getTransitionWeight(from: string, to: string): number | null;

  /** Hub score for a pattern, or 0 if unknown. */
  getConfidence(pattern: string): number;

  /** Record a token emission during ingest (unigram count). */
  recordEmission(pattern: string, delta?: number): void;

  /** Emission count for a pattern. */
  getTokenCount(pattern: string): number;

  /** Sum of all token emission counts. */
  getTotalEmissions(): number;

  /** Number of vocabulary nodes. */
  getVocabSize(): number;

  /** Sum of outgoing edge weights for a pattern. */
  getOutgoingTotal(from: string): number;
}
