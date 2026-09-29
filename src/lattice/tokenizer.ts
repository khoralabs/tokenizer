import { createLZSequencer } from "../lz-sequencer";
import { createFeedState, feedInputStream, feedInputStreamAsync } from "../pipeline/feed";
import { feedCharacters } from "../pipeline/feeds";
import type { Sequencer } from "../sequencer";
import type { Atom } from "./atom";
import type { IAsyncLattice, ILattice } from "./lattice";
import type { LatticeDecodeOptions } from "./tokenize";

export interface LatticeTokenizer {
  /** Character-grain feed (UTF-16 atoms). */
  feed(text: string): Promise<void>;
  /** Online feed of opaque atoms (any grain). */
  feedSource(source: AsyncGenerator<Atom>): Promise<void>;
  tokenize(text: string, options?: LatticeDecodeOptions): string[];
  tokenizeAtoms(source: readonly Atom[], options?: LatticeDecodeOptions): string[];
  vocabulary(): string[];
  getTopTokens(limit?: number): { pattern: string; confidence: number }[];
}

export interface AsyncLatticeTokenizer {
  feed(text: string): Promise<void>;
  feedSource(source: AsyncGenerator<Atom>): Promise<void>;
  tokenize(text: string, options?: LatticeDecodeOptions): Promise<string[]>;
  tokenizeAtoms(source: readonly Atom[], options?: LatticeDecodeOptions): Promise<string[]>;
  vocabulary(): Promise<string[]>;
  getTopTokens(limit?: number): Promise<{ pattern: string; confidence: number }[]>;
}

export interface LatticeTokenizerOptions {
  sequencer?: Sequencer;
  transitionBatchSize?: number;
}

export function createLatticeTokenizer(
  lattice: ILattice,
  options: LatticeTokenizerOptions = {},
): LatticeTokenizer {
  const sequencer = options.sequencer ?? createLZSequencer({ historyOptions: { bounded: false } });
  const batchSize = options.transitionBatchSize ?? 1000;
  const feedState = createFeedState();

  return {
    async feed(text: string) {
      await feedInputStream(lattice, sequencer, feedCharacters(text), feedState, batchSize);
    },

    async feedSource(source: AsyncGenerator<Atom>) {
      await feedInputStream(lattice, sequencer, source, feedState, batchSize);
    },

    tokenize(text: string, options?: LatticeDecodeOptions) {
      return lattice.tokenize(text, options);
    },

    tokenizeAtoms(source: readonly Atom[], options?: LatticeDecodeOptions) {
      return lattice.tokenizeAtoms(source, options);
    },

    vocabulary() {
      return lattice.vocabulary();
    },

    getTopTokens(limit = 10) {
      return lattice.getTopTokens(limit);
    },
  };
}

export function createAsyncLatticeTokenizer(
  lattice: IAsyncLattice,
  options: LatticeTokenizerOptions = {},
): AsyncLatticeTokenizer {
  const sequencer = options.sequencer ?? createLZSequencer({ historyOptions: { bounded: false } });
  const batchSize = options.transitionBatchSize ?? 1000;
  const feedState = createFeedState();

  return {
    async feed(text: string) {
      await feedInputStreamAsync(lattice, sequencer, feedCharacters(text), feedState, batchSize);
    },

    async feedSource(source: AsyncGenerator<Atom>) {
      await feedInputStreamAsync(lattice, sequencer, source, feedState, batchSize);
    },

    async tokenize(text: string, options?: LatticeDecodeOptions) {
      return lattice.tokenize(text, options);
    },

    async tokenizeAtoms(source: readonly Atom[], options?: LatticeDecodeOptions) {
      return lattice.tokenizeAtoms(source, options);
    },

    async vocabulary() {
      return lattice.vocabulary();
    },

    async getTopTokens(limit = 10) {
      return lattice.getTopTokens(limit);
    },
  };
}
