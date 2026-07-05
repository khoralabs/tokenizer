import type { IAsyncLattice, ILattice } from "../lattice/lattice";
import type { LatticeSegment } from "../lattice/segment";
import type { ISequencer, SequencerInput } from "../sequencer";

export type FeedState = {
  lastIngestedIndex: number;
  previousKey: string | null;
  transitionBatch: [string, string][];
};

export function createFeedState(): FeedState {
  return {
    lastIngestedIndex: 0,
    previousKey: null,
    transitionBatch: [],
  };
}

function toSegment(output: { key: string; sequence: readonly string[] }): LatticeSegment {
  return { key: output.key, sequence: [...output.sequence] };
}

export function ingestNewSegments(
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

export async function ingestNewSegmentsAsync(
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
    state.transitionBatch,
    batchSize,
  );
  state.lastIngestedIndex = sequencer.history.length;
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
    state.transitionBatch,
    batchSize,
  );
  state.lastIngestedIndex = sequencer.history.length;
}
