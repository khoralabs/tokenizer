import { describe, expect, test } from "bun:test";
import { Lattice } from "./sqlite/lattice";

describe("decode snapshot", () => {
  test("tokenize is stable across snapshot reload", () => {
    const lattice = new Lattice();
    lattice.ingestBatch([
      { key: "he", sequence: ["h", "e"] },
      { key: "llo", sequence: ["l", "l", "o"] },
    ]);
    for (let i = 0; i < 10; i++) lattice.merge([["he", "llo"]]);

    const text = "hello";
    const first = lattice.tokenize(text);
    lattice.invalidateDecodeSnapshot();
    const second = lattice.tokenize(text);

    expect(first).toEqual(["he", "llo"]);
    expect(second).toEqual(first);
    lattice.close();
  });
});
