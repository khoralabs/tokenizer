import { describe, expect, test } from "bun:test";
import { Lattice as MemoryLattice } from "./memory/lattice";
import { Lattice as SqliteLattice } from "./sqlite/lattice";
import { expectLatticeBasics } from "./test-helpers";
import { Lattice as TursoLattice } from "./turso/lattice";

describe("memory lattice", () => {
  test("merge, getNext, nextCharacters, getTopTokens", async () => {
    await expectLatticeBasics(() => new MemoryLattice());
  });

  test("mergeBatch accumulates edge weight", () => {
    const lattice = new MemoryLattice();
    lattice.merge([
      ["a", "b"],
      ["a", "b"],
    ]);
    expect(lattice.getNext("a")).toEqual([{ to: "b", weight: 2 }]);
    lattice.close();
  });
});

describe("sqlite lattice", () => {
  test("merge, getNext, nextCharacters, getTopTokens", async () => {
    await expectLatticeBasics(() => new SqliteLattice());
  });

  test("pipe ingests sequencer output", async () => {
    const lattice = new SqliteLattice();

    async function* source() {
      yield { key: "the<0>", sequence: ["t", "h", "e", "<0>"] };
      yield { key: "cat<0>", sequence: ["c", "a", "t", "<0>"] };
    }

    await lattice.pipe(source());
    expect(lattice.getNext("the<0>")).toEqual([{ to: "cat<0>", weight: 1 }]);
    expect(lattice.nextCharacters("")).toEqual(expect.arrayContaining(["t", "c"]));
    lattice.close();
  });
});

describe("turso lattice", () => {
  test("merge, getNext, nextCharacters, getTopTokens", async () => {
    await expectLatticeBasics(() => TursoLattice.open(":memory:"));
  });

  test("pipe ingests sequencer output", async () => {
    const lattice = await TursoLattice.open(":memory:");

    async function* source() {
      yield { key: "the<0>", sequence: ["t", "h", "e", "<0>"] };
      yield { key: "cat<0>", sequence: ["c", "a", "t", "<0>"] };
    }

    await lattice.pipe(source());
    expect(await lattice.getNext("the<0>")).toEqual([{ to: "cat<0>", weight: 1 }]);
    expect(await lattice.nextCharacters("")).toEqual(expect.arrayContaining(["t", "c"]));
    await lattice.close();
  });
});

describe("trie", () => {
  test("rejects empty pattern on sqlite", () => {
    const lattice = new SqliteLattice();
    expect(() => lattice.merge([["", "x"]])).toThrow("Cannot merge empty pattern");
    lattice.close();
  });

  test("rejects empty pattern on turso", async () => {
    const lattice = await TursoLattice.open(":memory:");
    await expect(lattice.merge([["", "x"]])).rejects.toThrow("Cannot merge empty pattern");
    await lattice.close();
  });
});
