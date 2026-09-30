import type { IAsyncLattice, ILattice } from "../lattice/lattice";
import type { LatticeSegment } from "../lattice/segment";
import type { ISequencer, SequencerInput, SequencerOutput } from "../sequencer";

export type WeightedPair = [string, string, number?];

export type FeedState = {
  previousKey: string | null;
  transitionCounts: Map<string, { from: string; to: string; count: number }>;
  pendingSegments: LatticeSegment[];
};

export const INGEST_BATCH_SIZE = 500;

export function createFeedState(): FeedState {
  return {
    previousKey: null,
    transitionCounts: new Map(),
    pendingSegments: [],
  };
}

function toSegment(output: SequencerOutput): LatticeSegment {
  return { key: output.key, sequence: output.sequence };
}

function transitionKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function recordTransition(
  counts: Map<string, { from: string; to: string; count: number }>,
  from: string,
  to: string,
): void {
  const key = transitionKey(from, to);
  const entry = counts.get(key);
  if (entry) entry.count += 1;
  else counts.set(key, { from, to, count: 1 });
}

function countsToPairs(
  counts: Map<string, { from: string; to: string; count: number }>,
): WeightedPair[] {
  return [...counts.values()].map(({ from, to, count }) => [from, to, count]);
}

function shouldFlush(
  pendingCount: number,
  transitionCount: number,
  transitionBatchSize: number,
): boolean {
  return pendingCount >= INGEST_BATCH_SIZE || transitionCount >= transitionBatchSize;
}

/** Commit pending segments and transitions without ending the sequencer sequence. */
export function flushFeedState(
  lattice: ILattice,
  state: FeedState,
  transitionBatchSize: number,
): void {
  const pairs = countsToPairs(state.transitionCounts);
  state.transitionCounts.clear();

  if (pairs.length > transitionBatchSize) {
    const segments = state.pendingSegments.splice(0);
    for (let i = 0; i < pairs.length; i += transitionBatchSize) {
      const pairBatch = pairs.slice(i, i + transitionBatchSize);
      const segmentBatch = i === 0 ? segments : [];
      lattice.commitFeedBatch(segmentBatch, pairBatch);
    }
    return;
  }

  lattice.commitFeedBatch(state.pendingSegments.splice(0), pairs);
}

/** Async variant of {@link flushFeedState}. */
export async function flushFeedStateAsync(
  lattice: IAsyncLattice,
  state: FeedState,
  transitionBatchSize: number,
): Promise<void> {
  const pairs = countsToPairs(state.transitionCounts);
  state.transitionCounts.clear();

  if (pairs.length > transitionBatchSize) {
    const segments = state.pendingSegments.splice(0);
    for (let i = 0; i < pairs.length; i += transitionBatchSize) {
      const pairBatch = pairs.slice(i, i + transitionBatchSize);
      const segmentBatch = i === 0 ? segments : [];
      await lattice.commitFeedBatch(segmentBatch, pairBatch);
    }
    return;
  }

  await lattice.commitFeedBatch(state.pendingSegments.splice(0), pairs);
}

function processOutputs(
  lattice: ILattice,
  outputs: SequencerOutput[],
  state: FeedState,
  transitionBatchSize: number,
): void {
  for (const output of outputs) {
    const segment = toSegment(output);
    state.pendingSegments.push(segment);

    if (state.previousKey !== null) {
      recordTransition(state.transitionCounts, state.previousKey, segment.key);
    }

    state.previousKey = segment.key;

    if (
      shouldFlush(state.pendingSegments.length, state.transitionCounts.size, transitionBatchSize)
    ) {
      flushFeedState(lattice, state, transitionBatchSize);
    }
  }
}

async function processOutputsAsync(
  lattice: IAsyncLattice,
  outputs: SequencerOutput[],
  state: FeedState,
  transitionBatchSize: number,
): Promise<void> {
  for (const output of outputs) {
    const segment = toSegment(output);
    state.pendingSegments.push(segment);

    if (state.previousKey !== null) {
      recordTransition(state.transitionCounts, state.previousKey, segment.key);
    }

    state.previousKey = segment.key;

    if (
      shouldFlush(state.pendingSegments.length, state.transitionCounts.size, transitionBatchSize)
    ) {
      await flushFeedStateAsync(lattice, state, transitionBatchSize);
    }
  }
}

/**
 * Push one atom through the sequencer and accumulate any emitted segments into feed state.
 * Does not call {@link ISequencer.flush}; unfinished candidates stay open.
 * Automatic batch thresholds still apply.
 */
export function feedInput(
  lattice: ILattice,
  sequencer: ISequencer,
  input: SequencerInput,
  state: FeedState,
  batchSize: number,
): void {
  sequencer.push(input);
  processOutputs(lattice, sequencer.drainPending(), state, batchSize);
}

/** Async variant of {@link feedInput}. */
export async function feedInputAsync(
  lattice: IAsyncLattice,
  sequencer: ISequencer,
  input: SequencerInput,
  state: FeedState,
  batchSize: number,
): Promise<void> {
  sequencer.push(input);
  await processOutputsAsync(lattice, sequencer.drainPending(), state, batchSize);
}

export async function feedInputStream(
  lattice: ILattice,
  sequencer: ISequencer,
  source: AsyncGenerator<SequencerInput>,
  state: FeedState,
  batchSize: number,
): Promise<void> {
  for await (const input of source) {
    feedInput(lattice, sequencer, input, state, batchSize);
  }
  await sequencer.endSequence();
  processOutputs(lattice, sequencer.drainPending(), state, batchSize);
  flushFeedState(lattice, state, batchSize);
}

export async function feedInputStreamAsync(
  lattice: IAsyncLattice,
  sequencer: ISequencer,
  source: AsyncGenerator<SequencerInput>,
  state: FeedState,
  batchSize: number,
): Promise<void> {
  for await (const input of source) {
    await feedInputAsync(lattice, sequencer, input, state, batchSize);
  }
  await sequencer.endSequence();
  await processOutputsAsync(lattice, sequencer.drainPending(), state, batchSize);
  await flushFeedStateAsync(lattice, state, batchSize);
}
