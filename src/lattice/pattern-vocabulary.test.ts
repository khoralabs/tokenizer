import { describe, expect, test } from "bun:test";
import { PatternVocabulary } from "./pattern-vocabulary";

describe("PatternVocabulary", () => {
  test("nextCharacters and matchCandidates use stored patterns", () => {
    const vocab = new PatternVocabulary();
    vocab.merge("hello", 0);
    vocab.merge("help", 0);

    expect(vocab.nextCharacters("hel").sort()).toEqual(["l", "p"]);
    expect(vocab.matchCandidates("say hello", 4)).toEqual([{ pattern: "hello", length: 5 }]);
  });
});
