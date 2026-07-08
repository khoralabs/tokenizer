import { describe, expect, test } from "bun:test";
import { Lattice } from "./sqlite/lattice";

describe("compiled lattice", () => {
  test("tokenize is stable across recompile", () => {
    const lattice = new Lattice();
    lattice.ingestBatch([
      { key: "he", sequence: ["h", "e"] },
      { key: "llo", sequence: ["l", "l", "o"] },
    ]);
    for (let i = 0; i < 10; i++) lattice.merge([["he", "llo"]]);

    const text = "hello";
    const first = lattice.tokenize(text);
    lattice.invalidateCompiled();
    const second = lattice.tokenize(text);

    expect(first).toEqual(["he", "llo"]);
    expect(second).toEqual(first);
    lattice.close();
  });
});
