import { describe, expect, test } from "bun:test";
import { atomsFromText } from "../lattice/atom";
import { Lattice } from "../lattice/memory/lattice";
import { decodeIndexed } from "../lattice/tokenize";
import { Unbounded } from "../lz-sequencer/dictionary/unbounded";
import { LZGate } from "../lz-sequencer/lz-gate";
import { Queue, Sequencer } from "../sequencer";
import { createFeedState, feedInputStream } from "./feed";
import { feedBytes, feedCharacters, feedSymbols } from "./feeds";
import type { IJob } from "./job";
import { Pipeline } from "./pipeline";

async function ingestFeed(source: AsyncGenerator<string>, options?: { atomDelimiter?: string }) {
  const lattice = new Lattice();
  const dictionary = new Unbounded();
  const sequencer = new Sequencer({
    gates: [new LZGate({ cache: dictionary })],
    queue: new Queue({ historyOptions: { bounded: false } }),
    atomDelimiter: options?.atomDelimiter ?? "",
  });
  await feedInputStream(lattice, sequencer, source, createFeedState(), 1000);
  const compiled = lattice.compile();
  return { lattice, sequencer, compiled };
}

function assertTrieMatchesHistory(
  history: { key: string; sequence: string[] }[],
  scanAtoms: (source: readonly string[]) => { pattern: string; length: number }[][],
) {
  expect(history.length).toBeGreaterThan(0);
  for (const { key, sequence } of history) {
    expect(sequence.length).toBeGreaterThan(0);
    const atZero = scanAtoms(sequence)[0] ?? [];
    expect(atZero).toContainEqual({ pattern: key, length: sequence.length });
  }
}

function decodeAtoms(compiled: ReturnType<Lattice["compile"]>, atoms: readonly string[]) {
  const byStart = compiled.scanAtoms(atoms);
  return decodeIndexed({
    length: atoms.length,
    matchCandidates: (offset) => byStart[offset] ?? [],
    fallbackCandidate: (offset) => {
      const atom = atoms[offset];
      return atom === undefined ? null : { pattern: atom, length: 1 };
    },
    emissionScore: (token) => compiled.emissionLogProb(token),
    transitionWeight: (from, to) => compiled.transitionLogProb(from, to),
  });
}

describe("feed alphabet → lattice / trie / decode", () => {
  test("characters: trie edges are UTF-16 atoms and text decode works", async () => {
    const text = "abababababab ";
    const { lattice, sequencer, compiled } = await ingestFeed(feedCharacters(text));

    assertTrieMatchesHistory(sequencer.history, (s) => compiled.scanAtoms(s));

    const multi = sequencer.history.find((h) => h.sequence.length > 1);
    expect(multi).toBeDefined();
    if (!multi) throw new Error("expected multi-atom segment");
    expect(multi.sequence).toEqual(atomsFromText(multi.key));

    // Character grain: text scan and atom scan agree
    expect(
      compiled
        .scan("ab")[0]
        ?.map((m) => m.pattern)
        .sort(),
    ).toEqual(
      compiled
        .scanAtoms(["a", "b"])[0]
        ?.map((m) => m.pattern)
        .sort(),
    );

    const detailed = decodeAtoms(compiled, atomsFromText("abab"));
    expect(detailed.complete).toBe(true);
    expect(detailed.tokens.join("")).toBe("abab");
    expect(lattice.tokenize("abab").join("")).toBe("abab");

    lattice.close();
  });

  test("bytes: trie edges are Latin-1 atoms and decode spans match byte count", async () => {
    const bytes = Uint8Array.of(0xff, 0x61, 0xff, 0x61, 0xff, 0x61, 0xff, 0x61);
    const atoms = [...bytes].map((b) => String.fromCharCode(b));
    const { lattice, sequencer, compiled } = await ingestFeed(feedBytes(bytes));

    assertTrieMatchesHistory(sequencer.history, (s) => compiled.scanAtoms(s));

    const multi = sequencer.history.find((h) => h.sequence.length > 1);
    expect(multi).toBeDefined();
    if (!multi) throw new Error("expected multi-atom segment");
    expect(multi.sequence.every((a) => a.length === 1)).toBe(true);
    expect(multi.sequence).toContain("\xff");

    const result = decodeAtoms(compiled, atoms);
    expect(result.complete).toBe(true);
    expect(result.steps.at(-1)?.end).toBe(atoms.length);
    expect(result.tokens.join("")).toBe(atoms.join(""));

    lattice.close();
  });

  test("symbols: trie edges are opaque atoms (not UTF-16 split) and indexed decode works", async () => {
    const symbols = [
      "svc:api",
      "lvl:err",
      "svc:api",
      "lvl:err",
      "svc:api",
      "lvl:ok",
      "svc:api",
      "lvl:err",
    ];
    const { lattice, sequencer, compiled } = await ingestFeed(feedSymbols(symbols), {
      atomDelimiter: "|",
    });

    assertTrieMatchesHistory(sequencer.history, (s) => compiled.scanAtoms(s));

    const multi = sequencer.history.find(
      (h) => h.sequence.length > 1 && h.sequence.some((a) => a.length > 1),
    );
    expect(multi).toBeDefined();
    if (!multi) throw new Error("expected multi-atom symbol segment");
    expect(multi.sequence).toEqual(["svc:api", "lvl:err"]);
    expect(multi.key).toBe("svc:api|lvl:err");

    // Opaque grain: whole-symbol scan hits; UTF-16 scan of the same key does not
    expect(compiled.scanAtoms(["svc:api"])[0]).toContainEqual({
      pattern: "svc:api",
      length: 1,
    });
    expect((compiled.scan("svc:api")[0] ?? []).some((m) => m.pattern === "svc:api")).toBe(false);

    const result = decodeAtoms(compiled, symbols);
    expect(result.complete).toBe(true);
    expect(result.steps.every((s) => Number.isInteger(s.end - s.start))).toBe(true);
    expect(result.steps.at(-1)?.end).toBe(symbols.length);
    expect(result.tokens.join("|")).toContain("svc:api");

    lattice.close();
  });

  test("Pipeline does not declare or check grain — feed yields define the alphabet", async () => {
    const dictionary = new Unbounded();
    const lattice = new Lattice();
    const sequencer = new Sequencer({
      gates: [new LZGate({ cache: dictionary })],
      queue: new Queue({ historyOptions: { bounded: false } }),
    });
    const pipeline = new Pipeline({ lattice, sequencer });

    class SymbolJob implements IJob {
      input() {
        return feedSymbols(["aa", "bb", "aa", "bb", "aa", "bb"]);
      }
    }

    await pipeline.run(new SymbolJob());
    const compiled = lattice.compile();

    expect(compiled.scanAtoms(["aa", "bb"])[0]).toContainEqual({
      pattern: "aabb",
      length: 2,
    });
    // Default delimiter "": key is concatenation; trie edges remain whole symbols
    expect(sequencer.history.some((h) => h.key === "aabb" && h.sequence.length === 2)).toBe(true);
    expect((compiled.scan("aabb")[0] ?? []).some((m) => m.pattern === "aabb")).toBe(false);

    lattice.close();
  });
});
