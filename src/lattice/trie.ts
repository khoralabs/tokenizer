import type { Atom, TerminalEntry } from "./atom";
import type { MatchCandidate } from "./tokenize";

export type { MatchCandidate };

/**
 * Interface for a prefix trie that stores patterns as paths of opaque atoms.
 */

export interface ITrie {
  /**
   * Insert a pattern along an atom path (one edge per atom).
   * @param atoms - Source atoms that compose the pattern
   * @param pattern - Terminal pattern key (graph identity)
   * @param markov_id - Associated markov node id
   */
  merge(atoms: readonly Atom[], pattern: string, markov_id: number): number;

  /**
   * Immediate child atoms of a prefix path.
   */
  nextAtoms(prefix: readonly Atom[]): Atom[];

  /**
   * @deprecated Prefer nextAtoms. Character-alphabet helper: prefix is UTF-16 code units.
   */
  nextCharacters(prefix: string): string[];

  /**
   * Vocabulary patterns matching at offset in an atom source.
   */
  matchCandidates(source: readonly Atom[], offset?: number): MatchCandidate[];

  /** Terminal vocabulary patterns for lattice compilation. */
  listTerminalPatterns(): string[];

  /** Terminal patterns with the atom paths used at insert time. */
  listTerminalEntries(): TerminalEntry[];
}
