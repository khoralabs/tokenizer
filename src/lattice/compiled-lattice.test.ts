import { describe, expect, test } from "bun:test";
import { buildLmTables, compilePatterns, tokenizeCompiled } from "./compiled-lattice";
import { Lattice } from "./sqlite/lattice";
import { createViterbiContext, decode } from "./tokenize";

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

  test("buildLmTables matches callback scoring for transitions", () => {
    const tokenCounts = new Map([
      ["a", 10],
      ["b", 5],
      ["c", 1],
    ]);
    const edges = [
      { from: "a", to: "b", weight: 8 },
      { from: "a", to: "c", weight: 2 },
      { from: "b", to: "c", weight: 3 },
    ];
    const outgoing = new Map([
      ["a", 10],
      ["b", 3],
    ]);
    const weight = new Map([
      ["a\0b", 8],
      ["a\0c", 2],
      ["b\0c", 3],
    ]);

    const lm = buildLmTables(tokenCounts, edges);
    const ctx = createViterbiContext({
      matchCandidates: () => [],
      getTokenCount: (t) => tokenCounts.get(t) ?? 0,
      getTotalEmissions: () => 16,
      getVocabSize: () => 3,
      getTransitionWeight: (from, to) => weight.get(`${from}\0${to}`) ?? null,
      getOutgoingTotal: (from) => outgoing.get(from) ?? 0,
    });

    expect(lm.transitionLogProb(null, "a")).toBe(0);
    expect(ctx.transitionWeight(null, "a")).toBe(0);

    expect(lm.transitionLogProb("a", "b")).toBe(ctx.transitionWeight("a", "b"));
    expect(lm.transitionLogProb("a", "missing")).toBe(ctx.transitionWeight("a", "missing"));
    expect(lm.transitionLogProb("b", "missing")).toBe(ctx.transitionWeight("b", "missing"));
    expect(lm.transitionLogProb("never", "a")).toBe(ctx.transitionWeight("never", "a"));

    // Higher outgoing mass → lower unseen-transition score (larger denominator)
    expect(lm.transitionLogProb("a", "missing")).toBeLessThan(lm.transitionLogProb("never", "a"));
  });

  test("tokenizeCompiled matches callback decode", () => {
    const tokenCounts = new Map([
      ["a", 5],
      ["b", 5],
      ["ab", 10],
      ["c", 5],
    ]);
    const edges = [
      { from: "a", to: "b", weight: 1 },
      { from: "ab", to: "c", weight: 20 },
    ];
    const lm = buildLmTables(tokenCounts, edges);
    const lattice = compilePatterns(["a", "b", "ab", "c"], lm);

    const weight = new Map([
      ["a\0b", 1],
      ["ab\0c", 20],
    ]);
    const outgoing = new Map([
      ["a", 1],
      ["ab", 20],
    ]);
    const ctx = createViterbiContext({
      matchCandidates: (text, offset) =>
        ["a", "b", "ab", "c"]
          .filter((p) => text.startsWith(p, offset))
          .map((pattern) => ({ pattern, length: pattern.length })),
      getTokenCount: (t) => tokenCounts.get(t) ?? 0,
      getTotalEmissions: () => 25,
      getVocabSize: () => 4,
      getTransitionWeight: (from, to) => weight.get(`${from}\0${to}`) ?? null,
      getOutgoingTotal: (from) => outgoing.get(from) ?? 0,
    });

    const text = "abc";
    expect(tokenizeCompiled(text, lattice)).toEqual(decode(text, ctx));
  });
});
