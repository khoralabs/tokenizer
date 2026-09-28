import { describe, expect, test } from "bun:test";
import { createLZSequencer } from "../lz-sequencer/create-lz-sequencer";
import { Unbounded } from "../lz-sequencer/dictionary/unbounded";
import { Queue } from "./queue/queue";
import { Sequencer } from "./sequencer";

const alwaysPass = {
  evaluate: () => true,
  reset: () => {},
  snapshot: async () => ({ name: "pass", ingested: 0, passRate: 0 }),
};

const failAfterLength = (max: number) => ({
  evaluate: (current: string) => current.length <= max,
  reset: () => {},
  snapshot: async () => ({ name: "length", ingested: 0, passRate: 0 }),
});

describe("Sequencer.evaluate", () => {
  test("continues while all gates pass", () => {
    expect(Sequencer.evaluate("", "a", [alwaysPass])).toEqual({ continue: "a" });
    expect(Sequencer.evaluate("a", "b", [alwaysPass])).toEqual({ continue: "ab" });
  });

  test("emits accumulated key when a gate fails", () => {
    expect(Sequencer.evaluate("he", "l", [failAfterLength(2)])).toEqual({
      reset: "l",
      emit: "he",
    });
  });

  test("resets without emit on first unknown input", () => {
    expect(Sequencer.evaluate("", "x", [failAfterLength(0)])).toEqual({ reset: "x" });
  });
});

describe("Sequencer", () => {
  test("emits segments through the queue", async () => {
    const queue = new Queue({ historyOptions: { bounded: false } });
    const sequencer = new Sequencer({ gates: [failAfterLength(2)], queue });

    sequencer.push("h");
    sequencer.push("e");
    sequencer.push("l");

    await sequencer.flush();
    await sequencer.close();

    const outputs = [];
    for await (const item of queue.read()) outputs.push(item);

    expect(outputs).toEqual([
      { key: "he", sequence: ["h", "e"] },
      { key: "l", sequence: ["l"] },
    ]);
    expect(sequencer.history).toEqual(outputs);
  });

  test("empty flush and endSequence emit nothing", async () => {
    const queue = new Queue({ historyOptions: { bounded: false } });
    const sequencer = new Sequencer({ gates: [alwaysPass], queue });

    await sequencer.flush();
    await sequencer.endSequence();

    expect(sequencer.drainPending()).toEqual([]);
    expect(sequencer.history).toEqual([]);
  });

  test("repeated feeds after flush do not reuse prior key", async () => {
    const queue = new Queue({ historyOptions: { bounded: false } });
    const sequencer = new Sequencer({ gates: [failAfterLength(2)], queue });

    sequencer.push("h");
    sequencer.push("e");
    await sequencer.flush();

    sequencer.push("x");
    await sequencer.flush();

    const outputs = sequencer.drainPending();
    expect(outputs).toEqual([
      { key: "he", sequence: ["h", "e"] },
      { key: "x", sequence: ["x"] },
    ]);
    expect(outputs.every((item) => item.sequence.length > 0 && item.key !== "")).toBe(true);
  });

  test("endSequence clears candidates and preserves dictionary", async () => {
    const cache = new Unbounded();
    const sequencer = createLZSequencer({
      cacheOptions: cache,
      historyOptions: { bounded: false },
    });

    for (const char of "abab") sequencer.push(char);
    await sequencer.endSequence();

    expect(cache.size).toBeGreaterThan(0);
    const sizeAfterBoundary = cache.size;

    sequencer.push("z");
    await sequencer.endSequence();
    expect(cache.size).toBeGreaterThanOrEqual(sizeAfterBoundary);

    const afterSecond = sequencer.drainPending();
    expect(afterSecond.every((item) => item.sequence.length > 0)).toBe(true);
  });

  test("reset clears candidates and dictionary", async () => {
    const cache = new Unbounded();
    const sequencer = createLZSequencer({
      cacheOptions: cache,
      historyOptions: { bounded: false },
    });

    for (const char of "abab") sequencer.push(char);
    await sequencer.endSequence();
    expect(cache.size).toBeGreaterThan(0);

    sequencer.reset();
    expect(cache.size).toBe(0);

    sequencer.push("a");
    await sequencer.flush();
    const outputs = sequencer.drainPending();
    expect(outputs.every((item) => item.sequence.length > 0)).toBe(true);
  });
});
