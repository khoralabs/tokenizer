import { describe, expect, test } from "bun:test";
import { Lattice as MemoryLattice } from "../lattice/memory/lattice";
import { Lattice as TursoLattice } from "../lattice/turso/lattice";
import { createLZSequencer } from "../lz-sequencer";
import {
  createFeedState,
  feedInput,
  feedInputAsync,
  flushFeedState,
  flushFeedStateAsync,
} from "./feed";

describe("incremental feed visibility", () => {
  test("flushFeedState commits below batch threshold without ending the sequence", () => {
    const lattice = new MemoryLattice();
    const sequencer = createLZSequencer({ historyOptions: { bounded: false } });
    const state = createFeedState();
    const batchSize = 1000;

    // First atom: no emit. Second: emit "a". Third: emit "b". Tip "c" stays open.
    feedInput(lattice, sequencer, "a", state, batchSize);
    feedInput(lattice, sequencer, "b", state, batchSize);
    feedInput(lattice, sequencer, "c", state, batchSize);

    expect(state.pendingSegments.map((s) => s.key)).toEqual(["a", "b"]);
    expect(state.transitionCounts.size).toBe(1);
    expect(lattice.vocabulary()).toEqual([]);
    expect(lattice.getNext("a")).toEqual([]);
    expect(sequencer.history.map((h) => h.key)).toEqual(["a", "b"]);

    flushFeedState(lattice, state, batchSize);

    expect(state.pendingSegments).toEqual([]);
    expect(state.transitionCounts.size).toBe(0);
    expect(lattice.vocabulary().sort()).toEqual(["a", "b"]);
    expect(lattice.getNext("a")).toEqual([{ to: "b", weight: 1 }]);
    // Unfinished tip "c" was not forced out by feed flush.
    expect(sequencer.history.map((h) => h.key)).toEqual(["a", "b"]);
    expect(sequencer.drainPending()).toEqual([]);

    lattice.close();
  });

  test("flushFeedStateAsync commits below batch threshold without ending the sequence", async () => {
    const lattice = await TursoLattice.open(":memory:");
    const sequencer = createLZSequencer({ historyOptions: { bounded: false } });
    const state = createFeedState();
    const batchSize = 1000;

    await feedInputAsync(lattice, sequencer, "a", state, batchSize);
    await feedInputAsync(lattice, sequencer, "b", state, batchSize);
    await feedInputAsync(lattice, sequencer, "c", state, batchSize);

    expect(state.pendingSegments.map((s) => s.key)).toEqual(["a", "b"]);
    expect(await lattice.vocabulary()).toEqual([]);
    expect(await lattice.getNext("a")).toEqual([]);

    await flushFeedStateAsync(lattice, state, batchSize);

    expect(state.pendingSegments).toEqual([]);
    expect((await lattice.vocabulary()).sort()).toEqual(["a", "b"]);
    expect(await lattice.getNext("a")).toEqual([{ to: "b", weight: 1 }]);
    expect(sequencer.history.map((h) => h.key)).toEqual(["a", "b"]);
    expect(sequencer.drainPending()).toEqual([]);

    await lattice.close();
  });
});
