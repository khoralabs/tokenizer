import { describe, expect, test } from "bun:test";
import { createLZSequencer } from "./create-lz-sequencer";

describe("createLZSequencer", () => {
  test("segments repeated patterns as the dictionary learns", async () => {
    const sequencer = createLZSequencer({
      historyOptions: { bounded: false },
    });

    for (const char of "abab") sequencer.push(char);
    await sequencer.flush();
    await sequencer.close();

    const outputs = [];
    for await (const item of sequencer.read()) outputs.push(item);

    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.every((item) => item.sequence.length > 0)).toBe(true);
    expect(outputs.flatMap((item) => item.sequence).join("")).toBe("abab");
  });

  test("respects bounded dictionary capacity", async () => {
    const sequencer = createLZSequencer({
      cacheOptions: { bounded: true, max: 2 },
      historyOptions: { bounded: true, maxLength: 4 },
    });

    for (const char of "abc") sequencer.push(char);
    await sequencer.flush();
    await sequencer.close();

    expect(sequencer.history.length).toBeLessThanOrEqual(4);
  });
});
