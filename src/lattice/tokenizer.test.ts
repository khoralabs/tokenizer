import { describe, expect, test } from "bun:test";
import type { ILattice } from "./lattice";
import { Lattice as MemoryLattice } from "./memory/lattice";
import { Lattice as SqliteLattice } from "./sqlite/lattice";
import { createViterbiContext, viterbiDecode } from "./tokenize";
import { createAsyncLatticeTokenizer, createLatticeTokenizer } from "./tokenizer";
import { Lattice as TursoLattice } from "./turso/lattice";

function trainSplitHello(lattice: ILattice) {
  for (let i = 0; i < 20; i++) {
    lattice.merge([["he", "llo"]]);
  }
  lattice.merge([["hello", "x"]]);
}

describe("viterbiDecode", () => {
  test("prefers high-weight transition path over single long token", () => {
    const ctx = createViterbiContext({
      matchCandidates(text, offset) {
        const matches: { pattern: string; length: number }[] = [];
        if (text.slice(offset, offset + 2) === "he") matches.push({ pattern: "he", length: 2 });
        if (text.slice(offset, offset + 3) === "llo") matches.push({ pattern: "llo", length: 3 });
        if (text.slice(offset, offset + 5) === "hello")
          matches.push({ pattern: "hello", length: 5 });
        return matches;
      },
      getTransitionWeight(from, to) {
        if (from === "he" && to === "llo") return 50;
        if (from === "hello" && to === "x") return 1;
        return null;
      },
      getConfidence(pattern) {
        if (pattern === "hello") return 10;
        return 1;
      },
    });

    expect(viterbiDecode("hello", ctx)).toEqual(["he", "llo"]);
  });
});

describe("memory lattice tokenize", () => {
  test("Viterbi path selection beats longest-prefix", () => {
    const lattice = new MemoryLattice();
    trainSplitHello(lattice);
    expect(lattice.tokenize("hello")).toEqual(["he", "llo"]);
    lattice.close();
  });

  test("ingest registers full pattern for candidate matching", () => {
    const lattice = new MemoryLattice();
    lattice.ingest({ key: "ab", sequence: ["a", "b"] });
    lattice.merge([["ab", "cd"]]);
    expect(lattice.tokenize("abcd")).toEqual(["ab", "cd"]);
    lattice.close();
  });

  test("vocabulary lists graph patterns", () => {
    const lattice = new MemoryLattice();
    lattice.merge([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(lattice.vocabulary().sort()).toEqual(["a", "b", "c", "d"]);
    lattice.close();
  });
});

describe("createLatticeTokenizer", () => {
  test("feed learns patterns and tokenize uses Viterbi", async () => {
    const lattice = new MemoryLattice();
    const tokenizer = createLatticeTokenizer(lattice);

    const corpus = "hello hello hello hello hello ";
    await tokenizer.feed(corpus);
    await tokenizer.feed(corpus);

    const vocab = tokenizer.vocabulary();
    expect(vocab.length).toBeGreaterThan(0);

    const tokens = tokenizer.tokenize("hello");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join("")).toBe("hello");

    lattice.close();
  });

  test("online read updates vocabulary mid-stream", async () => {
    const lattice = new MemoryLattice();
    const tokenizer = createLatticeTokenizer(lattice);

    expect(tokenizer.vocabulary()).toEqual([]);

    await tokenizer.feed("abc");
    expect(tokenizer.vocabulary().length).toBeGreaterThan(0);

    lattice.close();
  });
});

describe("backend tokenize parity", () => {
  test("sqlite lattice tokenize", () => {
    const lattice = new SqliteLattice();
    trainSplitHello(lattice);
    expect(lattice.tokenize("hello")).toEqual(["he", "llo"]);
    lattice.close();
  });

  test("turso lattice tokenize", async () => {
    const lattice = await TursoLattice.open(":memory:");
    for (let i = 0; i < 20; i++) {
      await lattice.merge([["he", "llo"]]);
    }
    await lattice.merge([["hello", "x"]]);
    expect(await lattice.tokenize("hello")).toEqual(["he", "llo"]);
    await lattice.close();
  });

  test("async tokenizer feed", async () => {
    const lattice = await TursoLattice.open(":memory:");
    const tokenizer = createAsyncLatticeTokenizer(lattice);

    await tokenizer.feed("test test test ");
    expect((await tokenizer.vocabulary()).length).toBeGreaterThan(0);

    await lattice.close();
  });
});
