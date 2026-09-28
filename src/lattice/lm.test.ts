import { describe, expect, test } from "bun:test";
import { bigramLogProb, unigramLogProb } from "./lm";

describe("lm", () => {
  const stats = { totalEmissions: 100, vocabSize: 10, smoothing: 0.1 };

  test("unigram favors higher count tokens", () => {
    expect(unigramLogProb(50, stats)).toBeGreaterThan(unigramLogProb(1, stats));
  });

  test("bigram favors observed transitions", () => {
    expect(bigramLogProb(20, 20, stats)).toBeGreaterThan(bigramLogProb(0, 20, stats));
  });

  test("empty vocabulary uses log(1 / smoothing)", () => {
    const empty = { totalEmissions: 0, vocabSize: 0, smoothing: 0.1 };
    expect(unigramLogProb(0, empty)).toBe(Math.log(1 / 0.1));
    expect(bigramLogProb(0, 0, empty)).toBe(Math.log(1 / 0.1));
  });
});
