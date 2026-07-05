import type { IAsyncLattice, ILattice } from "../lattice/lattice";
import type { LatticeSegment } from "../lattice/segment";
import type { ISequencer, SequencerInput } from "../sequencer";

export type WeightedPair = [string, string, number?];

export type FeedState = {
  lastIngestedIndex: number;
  previousKey: string | null;
  transitionCounts: Map<string, { from: string; to: string; count: number }>;
};

export function createFeedState(): FeedState {
  return {
    lastIngestedIndex: 0,
    previousKey: null,
    transitionCounts: new Map(),
  };
}

function toSegment(output: { key: string; sequence: readonly string[] }): LatticeSegment {
  return { key: output.key, sequence: [...output.sequence] };
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

function flushTransitionCounts(
  lattice: ILattice,
  counts: Map<string, { from: string; to: string; count: number }>,
  batchSize: number,
): void {
  const pairs = countsToPairs(counts);
  counts.clear();
  for (let i = 0; i < pairs.length; i += batchSize) {
    lattice.merge(pairs.slice(i, i + batchSize));
  }
}

async function flushTransitionCountsAsync(
  lattice: IAsyncLattice,
  counts: Map<string, { from: string; to: string; count: number }>,
  batchSize: number,
): Promise<void> {
  const pairs = countsToPairs(counts);
  counts.clear();
  for (let i = 0; i < pairs.length; i += batchSize) {
    await lattice.merge(pairs.slice(i, i + batchSize));
  }
}

async function refreshHubScores(lattice: ILattice | IAsyncLattice): Promise<void> {
  await lattice.getTopTokens(1);
}

const INGEST_BATCH_SIZE = 100;

export function ingestNewSegments(
  lattice: ILattice,
  history: { key: string; sequence: readonly string[] }[],
  startIndex: number,
  previousKey: string | null,
  counts: Map<string, { from: string; to: string; count: number }>,
  batchSize: number,
): string | null {
  let prev = previousKey;
  const pending: LatticeSegment[] = [];

  const flushPending = (): void => {
    if (pending.length === 0) return;
    lattice.ingestBatch(pending.splice(0));
  };

  for (let i = startIndex; i < history.length; i++) {
    const output = history[i];
    if (!output) continue;

    const segment = toSegment(output);
    pending.push(segment);
    if (pending.length >= INGEST_BATCH_SIZE) flushPending();

    if (prev !== null) {
      recordTransition(counts, prev, segment.key);
      if (counts.size >= batchSize) {
        flushPending();
        flushTransitionCounts(lattice, counts, batchSize);
      }
    }

    prev = segment.key;
  }

  flushPending();
  if (counts.size > 0) {
    flushTransitionCounts(lattice, counts, batchSize);
  }

  return prev;
}

export async function ingestNewSegmentsAsync(
  lattice: IAsyncLattice,
  history: { key: string; sequence: readonly string[] }[],
  startIndex: number,
  previousKey: string | null,
  counts: Map<string, { from: string; to: string; count: number }>,
  batchSize: number,
): Promise<string | null> {
  let prev = previousKey;
  const pending: LatticeSegment[] = [];

  const flushPending = async (): Promise<void> => {
    if (pending.length === 0) return;
    await lattice.ingestBatch(pending.splice(0));
  };

  for (let i = startIndex; i < history.length; i++) {
    const output = history[i];
    if (!output) continue;

    const segment = toSegment(output);
    pending.push(segment);
    if (pending.length >= INGEST_BATCH_SIZE) await flushPending();

    if (prev !== null) {
      recordTransition(counts, prev, segment.key);
      if (counts.size >= batchSize) {
        await flushPending();
        await flushTransitionCountsAsync(lattice, counts, batchSize);
      }
    }

    prev = segment.key;
  }

  await flushPending();
  if (counts.size > 0) {
    await flushTransitionCountsAsync(lattice, counts, batchSize);
  }

  return prev;
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
  }
  await sequencer.flush();
  sequencer.drainPending();

  state.previousKey = ingestNewSegments(
    lattice,
    sequencer.history,
    state.lastIngestedIndex,
    state.previousKey,
    state.transitionCounts,
    batchSize,
  );
  state.lastIngestedIndex = sequencer.history.length;
  await refreshHubScores(lattice);
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
  }
  await sequencer.flush();
  sequencer.drainPending();

  state.previousKey = await ingestNewSegmentsAsync(
    lattice,
    sequencer.history,
    state.lastIngestedIndex,
    state.previousKey,
    state.transitionCounts,
    batchSize,
  );
  state.lastIngestedIndex = sequencer.history.length;
  await refreshHubScores(lattice);
}
