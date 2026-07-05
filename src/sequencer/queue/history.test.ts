import { describe, expect, test } from "bun:test";
import { BoundedHistory, UnboundedHistory } from "./history";

describe("UnboundedHistory", () => {
  test("stores outputs in order", () => {
    const history = new UnboundedHistory();
    history.push({ key: "a", sequence: ["a"] });
    history.push({ key: "ab", sequence: ["a", "b"] });

    expect(history.size).toBe(2);
    expect(history.get()).toEqual([
      { key: "a", sequence: ["a"] },
      { key: "ab", sequence: ["a", "b"] },
    ]);
  });

  test("clear resets history", () => {
    const history = new UnboundedHistory();
    history.push({ key: "a", sequence: ["a"] });
    history.clear();
    expect(history.size).toBe(0);
    expect(history.get()).toEqual([]);
  });
});

describe("BoundedHistory", () => {
  test("evicts oldest entries at capacity", () => {
    const history = new BoundedHistory(2);
    history.push({ key: "a", sequence: ["a"] });
    history.push({ key: "ab", sequence: ["a", "b"] });
    history.push({ key: "abc", sequence: ["a", "b", "c"] });

    expect(history.size).toBe(2);
    expect(history.get()).toEqual([
      { key: "ab", sequence: ["a", "b"] },
      { key: "abc", sequence: ["a", "b", "c"] },
    ]);
  });

  test("rejects invalid max", () => {
    expect(() => new BoundedHistory(0)).toThrow("History max must be a positive integer");
    expect(() => new BoundedHistory(Number.NaN)).toThrow("History max must be a positive integer");
  });
});
