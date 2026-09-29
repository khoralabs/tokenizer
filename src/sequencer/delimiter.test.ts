import { describe, expect, test } from "bun:test";
import { joinAtoms, splitAtoms } from "../lattice/atom";
import { Queue } from "./queue/queue";
import { Sequencer } from "./sequencer";

const alwaysPass = {
  evaluate: () => true,
  reset: () => {},
  snapshot: async () => ({ name: "pass", ingested: 0, passRate: 0 }),
};

describe("atom delimiters", () => {
  test("joinAtoms and splitAtoms round-trip", () => {
    expect(joinAtoms(["a", "b"], "|")).toBe("a|b");
    expect(splitAtoms("a|b|c|", "|")).toEqual(["a", "b", "c"]);
    expect(splitAtoms("abc", "")).toEqual(["a", "b", "c"]);
  });

  test("sequencer atomDelimiter joins keys without entering decode", async () => {
    const queue = new Queue({ historyOptions: { bounded: false } });
    const sequencer = new Sequencer({
      gates: [alwaysPass],
      queue,
      atomDelimiter: "|",
    });

    sequencer.push("foo");
    sequencer.push("bar");
    await sequencer.flush();

    expect(sequencer.drainPending()).toEqual([{ key: "foo|bar", sequence: ["foo", "bar"] }]);
  });
});
