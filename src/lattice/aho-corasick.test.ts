import { describe, expect, test } from "bun:test";
import { AhoCorasick } from "./aho-corasick";

function bruteForceMatches(patterns: string[], text: string, offset: number) {
  const matches: { pattern: string; length: number }[] = [];
  for (const pattern of patterns) {
    if (text.slice(offset, offset + pattern.length) === pattern) {
      matches.push({ pattern, length: pattern.length });
    }
  }
  return matches;
}

describe("AhoCorasick", () => {
  test("matches agree with brute-force scan", () => {
    const patterns = ["he", "llo", "hello", "a", "ab", "b", "c"];
    const ac = new AhoCorasick(patterns);
    const text = "hello abc";
    const byStart = ac.matchStarts(text);

    for (let offset = 0; offset < text.length; offset++) {
      const fromAc = byStart[offset] ?? [];
      const expected = bruteForceMatches(patterns, text, offset);
      expect(fromAc.sort((a, b) => a.pattern.localeCompare(b.pattern))).toEqual(
        expected.sort((a, b) => a.pattern.localeCompare(b.pattern)),
      );
    }
  });

  test("finds overlapping patterns at one offset", () => {
    const ac = new AhoCorasick(["a", "ab", "abc"]);
    const atZero = ac.matchStarts("abc")[0] ?? [];
    expect(atZero.map((m) => m.pattern).sort()).toEqual(["a", "ab", "abc"]);
  });
});
