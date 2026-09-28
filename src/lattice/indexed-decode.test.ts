import { describe, expect, test } from "bun:test";
import { buildLmTables, compilePatterns } from "./compiled-lattice";
import {
  createViterbiContext,
  decode,
  decodeDetailed,
  decodeIndexed,
  decodeIndexedAsync,
  type IndexedDecodeContext,
} from "./tokenize";

function scoredContext(
  overrides: Partial<IndexedDecodeContext> &
    Pick<IndexedDecodeContext, "length" | "matchCandidates">,
): IndexedDecodeContext {
  return {
    fallbackCandidate: () => null,
    transitionWeight: () => 0,
    emissionScore: () => -1,
    ...overrides,
  };
}

describe("decodeIndexed", () => {
  test("indexed length can differ from pattern string length", () => {
    const result = decodeIndexed(
      scoredContext({
        length: 2,
        matchCandidates: (offset) =>
          offset === 0 ? [{ pattern: "ab", length: 1 }] : [{ pattern: "c", length: 1 }],
        fallbackCandidate: () => null,
      }),
    );
    expect(result.complete).toBe(true);
    expect(result.tokens).toEqual(["ab", "c"]);
    expect(result.steps.map((s) => ({ start: s.start, end: s.end }))).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);
  });

  test("records spans and cumulative scores", () => {
    const result = decodeIndexed(
      scoredContext({
        length: 2,
        matchCandidates: (offset) => [{ pattern: offset === 0 ? "a" : "b", length: 1 }],
        emissionScore: (token) => (token === "a" ? -1 : -2),
        transitionWeight: (from) => (from === null ? 0 : -0.5),
      }),
    );
    expect(result.complete).toBe(true);
    expect(result.steps[0]).toMatchObject({
      token: "a",
      start: 0,
      end: 1,
      emissionScore: -1,
      transitionScore: 0,
      cumulativeScore: -1,
    });
    expect(result.steps[1]).toMatchObject({
      token: "b",
      start: 1,
      end: 2,
      emissionScore: -2,
      transitionScore: -0.5,
      cumulativeScore: -3.5,
    });
    expect(result.score).toBe(-3.5);
  });

  test("uses primitive fallback when matchCandidates empty", () => {
    const result = decodeIndexed(
      scoredContext({
        length: 2,
        matchCandidates: () => [],
        fallbackCandidate: (offset) => ({ pattern: `s${offset}`, length: 1 }),
      }),
    );
    expect(result.tokens).toEqual(["s0", "s1"]);
  });

  test("no complete path returns incomplete result", () => {
    const result = decodeIndexed(
      scoredContext({
        length: 2,
        matchCandidates: () => [],
        fallbackCandidate: () => null,
      }),
    );
    expect(result).toEqual({
      tokens: [],
      steps: [],
      score: Number.NEGATIVE_INFINITY,
      complete: false,
    });
  });

  test("wide beam matches viterbi", () => {
    const ctx = scoredContext({
      length: 3,
      matchCandidates: (offset) => [{ pattern: String(offset), length: 1 }],
      emissionScore: () => -1,
      transitionWeight: () => -0.1,
    });
    const v = decodeIndexed(ctx);
    const b = decodeIndexed(ctx, { mode: "beam", beamWidth: 32 });
    expect(b.tokens).toEqual(v.tokens);
    expect(b.score).toBe(v.score);
  });

  test("rejects invalid candidate lengths", () => {
    expect(() =>
      decodeIndexed(
        scoredContext({
          length: 1,
          matchCandidates: () => [{ pattern: "x", length: 0 }],
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      decodeIndexed(
        scoredContext({
          length: 1,
          matchCandidates: () => [{ pattern: "x", length: 2 }],
        }),
      ),
    ).toThrow(RangeError);
  });

  test("useBigram false zeros transition contribution", () => {
    const base = scoredContext({
      length: 2,
      matchCandidates: (offset) => [{ pattern: offset === 0 ? "a" : "b", length: 1 }],
      emissionScore: () => -1,
      transitionWeight: () => -10,
    });
    const withBigram = decodeIndexed(base, { useBigram: true });
    const without = decodeIndexed(base, { useBigram: false });
    expect(without.score).toBeGreaterThan(withBigram.score);
    expect(without.steps.every((s) => s.transitionScore === 0)).toBe(true);
  });

  test("sync and async parity", async () => {
    const sync = decodeIndexed(
      scoredContext({
        length: 2,
        matchCandidates: (offset) => [{ pattern: `t${offset}`, length: 1 }],
      }),
    );
    const asyncResult = await decodeIndexedAsync({
      length: 2,
      matchCandidates: async (offset) => [{ pattern: `t${offset}`, length: 1 }],
      fallbackCandidate: async () => null,
      transitionWeight: async () => 0,
      emissionScore: async () => -1,
    });
    expect(asyncResult).toEqual(sync);
  });
});

describe("decodeDetailed text adapter", () => {
  test("decode remains backward compatible", () => {
    const ctx = createViterbiContext({
      matchCandidates: (text, offset) => {
        const ch = text[offset];
        if (text.startsWith("ab", offset)) {
          return [
            { pattern: "a", length: 1 },
            { pattern: "ab", length: 2 },
          ];
        }
        return ch === undefined ? [] : [{ pattern: ch, length: 1 }];
      },
      getTokenCount: (t) => (t === "ab" ? 10 : 1),
      getTotalEmissions: () => 12,
      getVocabSize: () => 3,
      getTransitionWeight: () => null,
      getOutgoingTotal: () => 0,
      useBigram: false,
    });
    const detailed = decodeDetailed("ab", ctx);
    expect(decode("ab", ctx)).toEqual(detailed.tokens);
    expect(detailed.complete).toBe(true);
  });
});

describe("compiled patterns and smoothing", () => {
  test("compiled.patterns lists trie terminals", () => {
    const lm = buildLmTables(new Map([["a", 1]]), []);
    const compiled = compilePatterns(
      [
        { pattern: "foo|bar|", atoms: ["foo|", "bar|"] },
        { pattern: "foo|", atoms: ["foo|"] },
      ],
      lm,
    );
    expect(compiled.patterns).toEqual(["foo|bar|", "foo|"]);
    expect(
      compiled
        .scanAtoms(["foo|", "bar|"])[0]
        ?.map((m) => m.pattern)
        .sort(),
    ).toEqual(["foo|", "foo|bar|"]);
  });

  test("smoothing changes scores predictably", () => {
    const counts = new Map([
      ["a", 10],
      ["b", 1],
    ]);
    const low = buildLmTables(counts, [], { smoothing: 0.01 });
    const high = buildLmTables(counts, [], { smoothing: 1 });
    expect(low.emissionLogProb("a")).not.toBe(high.emissionLogProb("a"));
    expect(low.emissionLogProb("missing")).toBeLessThan(high.emissionLogProb("missing"));
    expect(() => buildLmTables(counts, [], { smoothing: 0 })).toThrow(RangeError);
  });
});
