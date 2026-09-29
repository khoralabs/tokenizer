import type { Atom } from "./atom";
import type { ICompiledLattice, LmCompileOptions } from "./compiled-lattice";
import type { LatticeSegment } from "./segment";
import type { LatticeDecodeOptions } from "./tokenize";

/**
 * Interface for a Lattice that composes a Trie for token storage and a Graph for transitions.
 */
export interface ILattice {
  /**
   * Merge sequences of tokens into the Lattice
   * @param pairs - Array of [from, to] token pairs
   */
  merge(pairs: [string, string, number?][]): void;

  /**
   * Retrieves all outgoing transitions for a token.
   * @param from - The source token
   * @returns Array of transitions with weights
   */
  getNext(from: string): { to: string; weight: number }[];

  /**
   * Immediate child atoms of a trie prefix path.
   */
  nextAtoms(prefix: readonly Atom[]): Atom[];

  /**
   * @deprecated Prefer `nextAtoms`. Character-alphabet helper: prefix is UTF-16 code units.
   */
  nextCharacters(prefix: string): string[];

  /**
   * Returns top N tokens by hub score using the configured scoring algorithm.
   * @param limit - Number of tokens to return (default 10)
   * @returns Array of tokens with confidences
   */
  getTopTokens(limit?: number): { pattern: string; confidence: number }[];

  /**
   * Ingest a single sequencer segment into the lattice.
   */
  ingest(segment: LatticeSegment): void;

  /**
   * Ingest multiple segments in one storage transaction.
   */
  ingestBatch(segments: LatticeSegment[]): void;

  /**
   * Ingest segments and merge transitions in a single storage transaction.
   */
  commitFeedBatch(segments: LatticeSegment[], pairs: [string, string, number?][]): void;

  /**
   * Tokenize text via Viterbi decoding over graph transitions and trie candidates.
   */
  tokenize(text: string, options?: LatticeDecodeOptions): string[];

  /**
   * Build an in-memory decode index (Aho-Corasick + LM tables) from persisted state.
   * Non-default smoothing returns an uncached snapshot.
   */
  compile(options?: LmCompileOptions): ICompiledLattice;

  /** Drop cached compiled lattice after ingest or merge. */
  invalidateCompiled(): void;

  /** All pattern strings in the graph vocabulary. */
  vocabulary(): string[];

  /**
   * Pipes segments from an async generator into the lattice.
   * - Trie: one edge per `sequence` atom (including sentinel-shaped atoms)
   * - Graph: transitions between consecutive pattern keys
   *
   * Example: sequence `["svc:api", "lvl:err"]` with key `"svc:api|lvl:err"` creates:
   * - Graph node for the pattern key
   * - Trie path with edges `svc:api` → `lvl:err`
   * - Graph transitions between consecutive segment keys
   *
   * @param source - AsyncGenerator of `LatticeSegment` (e.g. from sequencer output)
   * @param batchSize - Number of pairs to batch before merging (default 1000)
   */
  pipe(source: AsyncGenerator<LatticeSegment, void, unknown>, batchSize?: number): Promise<void>;

  /**
   * Closes the underlying storage/database connection.
   */
  close(): void;
}

/**
 * Async lattice interface for backends such as Turso that use non-blocking I/O.
 */
export interface IAsyncLattice {
  merge(pairs: [string, string, number?][]): Promise<void>;
  getNext(from: string): Promise<{ to: string; weight: number }[]>;
  nextAtoms(prefix: readonly Atom[]): Promise<Atom[]>;
  /** @deprecated Prefer `nextAtoms`. Character-alphabet helper: prefix is UTF-16 code units. */
  nextCharacters(prefix: string): Promise<string[]>;
  getTopTokens(limit?: number): Promise<{ pattern: string; confidence: number }[]>;
  ingest(segment: LatticeSegment): Promise<void>;
  ingestBatch(segments: LatticeSegment[]): Promise<void>;
  commitFeedBatch(segments: LatticeSegment[], pairs: [string, string, number?][]): Promise<void>;
  tokenize(text: string, options?: LatticeDecodeOptions): Promise<string[]>;
  compile(options?: LmCompileOptions): Promise<ICompiledLattice>;
  invalidateCompiled(): void;
  vocabulary(): Promise<string[]>;
  pipe(source: AsyncGenerator<LatticeSegment, void, unknown>, batchSize?: number): Promise<void>;
  close(): Promise<void>;
}
