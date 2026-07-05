import { createLZSequencer } from "../lz-sequencer";
import { createFeedState, feedInputStream, feedInputStreamAsync } from "../pipeline/feed";
import type { Sequencer } from "../sequencer";
import type { IAsyncLattice, ILattice } from "./lattice";
import type { LatticeDecodeOptions } from "./tokenize";

export interface LatticeTokenizer {
  feed(text: string): Promise<void>;
  tokenize(text: string, options?: LatticeDecodeOptions): string[];
  vocabulary(): string[];
  getTopTokens(limit?: number): { pattern: string; confidence: number }[];
}

export interface AsyncLatticeTokenizer {
  feed(text: string): Promise<void>;
  tokenize(text: string, options?: LatticeDecodeOptions): Promise<string[]>;
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
      async function* source() {
        for (const char of text) yield char;
      }
      await feedInputStream(lattice, sequencer, source(), feedState, batchSize);
    },

    tokenize(text: string, options?: LatticeDecodeOptions) {
      return lattice.tokenize(text, options);
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
      async function* source() {
        for (const char of text) yield char;
      }
      await feedInputStreamAsync(lattice, sequencer, source(), feedState, batchSize);
    },

    async tokenize(text: string, options?: LatticeDecodeOptions) {
      return lattice.tokenize(text, options);
    },

    async vocabulary() {
      return lattice.vocabulary();
    },

    async getTopTokens(limit = 10) {
      return lattice.getTopTokens(limit);
    },
  };
}
