import { createLZSequencer } from "../lz-sequencer";
import type { Sequencer } from "../sequencer";
import type { IAsyncLattice, ILattice } from "./lattice";
import type { LatticeSegment } from "./segment";

export interface LatticeTokenizer {
  feed(text: string): Promise<void>;
  tokenize(text: string): string[];
  vocabulary(): string[];
  getTopTokens(limit?: number): { pattern: string; confidence: number }[];
}

export interface AsyncLatticeTokenizer {
  feed(text: string): Promise<void>;
  tokenize(text: string): Promise<string[]>;
  vocabulary(): Promise<string[]>;
  getTopTokens(limit?: number): Promise<{ pattern: string; confidence: number }[]>;
}

export interface LatticeTokenizerOptions {
  sequencer?: Sequencer;
  transitionBatchSize?: number;
}

function toSegment(output: { key: string; sequence: readonly string[] }): LatticeSegment {
  return { key: output.key, sequence: [...output.sequence] };
}

function ingestNewSegments(
  lattice: ILattice,
  history: { key: string; sequence: readonly string[] }[],
  startIndex: number,
  previousKey: string | null,
  batch: [string, string][],
  batchSize: number,
): string | null {
  let prev = previousKey;

  for (let i = startIndex; i < history.length; i++) {
    const output = history[i];
    if (!output) continue;

    const segment = toSegment(output);
    lattice.ingest(segment);

    if (prev !== null) {
      batch.push([prev, segment.key]);
      if (batch.length >= batchSize) {
        lattice.merge(batch.splice(0, batchSize));
      }
    }

    prev = segment.key;
  }

  if (batch.length > 0) {
    lattice.merge(batch.splice(0));
  }

  return prev;
}

async function ingestNewSegmentsAsync(
  lattice: IAsyncLattice,
  history: { key: string; sequence: readonly string[] }[],
  startIndex: number,
  previousKey: string | null,
  batch: [string, string][],
  batchSize: number,
): Promise<string | null> {
  let prev = previousKey;

  for (let i = startIndex; i < history.length; i++) {
    const output = history[i];
    if (!output) continue;

    const segment = toSegment(output);
    await lattice.ingest(segment);

    if (prev !== null) {
      batch.push([prev, segment.key]);
      if (batch.length >= batchSize) {
        await lattice.merge(batch.splice(0, batchSize));
      }
    }

    prev = segment.key;
  }

  if (batch.length > 0) {
    await lattice.merge(batch.splice(0));
  }

  return prev;
}

export function createLatticeTokenizer(
  lattice: ILattice,
  options: LatticeTokenizerOptions = {},
): LatticeTokenizer {
  const sequencer = options.sequencer ?? createLZSequencer({ historyOptions: { bounded: false } });
  const batchSize = options.transitionBatchSize ?? 1000;

  let lastIngestedIndex = 0;
  let previousKey: string | null = null;
  const transitionBatch: [string, string][] = [];

  return {
    async feed(text: string) {
      for (const char of text) {
        sequencer.push(char);
      }
      await sequencer.flush();
      sequencer.drainPending();

      previousKey = ingestNewSegments(
        lattice,
        sequencer.history,
        lastIngestedIndex,
        previousKey,
        transitionBatch,
        batchSize,
      );
      lastIngestedIndex = sequencer.history.length;
    },

    tokenize(text: string) {
      return lattice.tokenize(text);
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

  let lastIngestedIndex = 0;
  let previousKey: string | null = null;
  const transitionBatch: [string, string][] = [];

  return {
    async feed(text: string) {
      for (const char of text) {
        sequencer.push(char);
      }
      await sequencer.flush();
      sequencer.drainPending();

      previousKey = await ingestNewSegmentsAsync(
        lattice,
        sequencer.history,
        lastIngestedIndex,
        previousKey,
        transitionBatch,
        batchSize,
      );
      lastIngestedIndex = sequencer.history.length;
    },

    async tokenize(text: string) {
      return lattice.tokenize(text);
    },

    async vocabulary() {
      return lattice.vocabulary();
    },

    async getTopTokens(limit = 10) {
      return lattice.getTopTokens(limit);
    },
  };
}
