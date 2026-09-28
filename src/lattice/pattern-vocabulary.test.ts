import { describe, expect, test } from "bun:test";
import { PatternVocabulary } from "./pattern-vocabulary";

describe("PatternVocabulary", () => {
  test("nextCharacters and matchCandidates use stored atom paths", () => {
    const vocab = new PatternVocabulary();
    vocab.merge([..."hello"], "hello", 0);
    vocab.merge([..."help"], "help", 0);

    expect(vocab.nextCharacters("hel").sort()).toEqual(["l", "p"]);
    expect(vocab.matchCandidates([..."say hello"], 4)).toEqual([{ pattern: "hello", length: 5 }]);
  });

  test("symbol atoms are not UTF-16 split", () => {
    const vocab = new PatternVocabulary();
    vocab.merge(["foo|", "bar|"], "foo|bar|", 0);
    vocab.merge(["foo|"], "foo|", 0);

    expect(vocab.nextAtoms([])).toEqual(["foo|"]);
    expect(vocab.nextAtoms(["foo|"])).toEqual(["bar|"]);
    expect(vocab.matchCandidates(["foo|", "bar|"], 0)).toEqual([
      { pattern: "foo|", length: 1 },
      { pattern: "foo|bar|", length: 2 },
    ]);
    expect(vocab.listTerminalEntries()).toEqual(
      expect.arrayContaining([
        { pattern: "foo|bar|", atoms: ["foo|", "bar|"] },
        { pattern: "foo|", atoms: ["foo|"] },
      ]),
    );
  });
});
