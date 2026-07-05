import { describe, expect, test } from "bun:test";
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
});
