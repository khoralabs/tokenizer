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
  return { key: output.key, sequence: output.sequence as string[] };
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

function flushFeedBatch(lattice: ILattice, state: FeedState, transitionBatchSize: number): void {
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

async function flushFeedBatchAsync(
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
      flushFeedBatch(lattice, state, transitionBatchSize);
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
      await flushFeedBatchAsync(lattice, state, transitionBatchSize);
    }
  }
}

export async function feedInputStream(
  lattice: ILattice,
  sequencer: ISequencer,
  source: AsyncGenerator<SequencerInput>,
  state: FeedState,
  batchSize: number,
): Promise<void> {
  for await (const input of source) {
    sequencer.push(input);
    processOutputs(lattice, sequencer.drainPending(), state, batchSize);
  }
  await sequencer.flush();
  processOutputs(lattice, sequencer.drainPending(), state, batchSize);
  flushFeedBatch(lattice, state, batchSize);
}

export async function feedInputStreamAsync(
  lattice: IAsyncLattice,
  sequencer: ISequencer,
  source: AsyncGenerator<SequencerInput>,
  state: FeedState,
  batchSize: number,
): Promise<void> {
  for await (const input of source) {
    sequencer.push(input);
    await processOutputsAsync(lattice, sequencer.drainPending(), state, batchSize);
  }
  await sequencer.flush();
  await processOutputsAsync(lattice, sequencer.drainPending(), state, batchSize);
  await flushFeedBatchAsync(lattice, state, batchSize);
}
