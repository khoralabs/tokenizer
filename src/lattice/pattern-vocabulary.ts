import { AhoCorasick } from "./aho-corasick";
import type { Atom, TerminalEntry } from "./atom";
import { assertNonEmptyAtoms, atomsFromText } from "./atom";
import type { ITrie, MatchCandidate } from "./trie";

/** In-memory vocabulary backed by Aho-Corasick for pattern matching. */
export class PatternVocabulary implements ITrie {
  private entries = new Map<string, Atom[]>();
  private matcher: AhoCorasick | null = null;

  merge(atoms: readonly Atom[], pattern: string, _markov_id: number): number {
    assertNonEmptyAtoms(atoms);
    if (pattern.length === 0) throw new Error("Cannot merge empty pattern");
    this.entries.set(pattern, [...atoms]);
    this.matcher = null;
    return 0;
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  listTerminalPatterns(): string[] {
    return this.list();
  }

  listTerminalEntries(): TerminalEntry[] {
    return [...this.entries.entries()].map(([pattern, atoms]) => ({ pattern, atoms }));
  }

  invalidate(): void {
    this.matcher = null;
  }

  nextAtoms(prefix: readonly Atom[]): Atom[] {
    const next = new Set<Atom>();
    for (const atoms of this.entries.values()) {
      if (atoms.length <= prefix.length) continue;
      let ok = true;
      for (let i = 0; i < prefix.length; i++) {
        if (atoms[i] !== prefix[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const child = atoms[prefix.length];
      if (child !== undefined) next.add(child);
    }
    return [...next];
  }

  nextCharacters(prefix: string): string[] {
    return this.nextAtoms(atomsFromText(prefix));
  }

  matchCandidates(source: readonly Atom[], offset = 0): MatchCandidate[] {
    return this.getMatcher().matchStarts(source)[offset] ?? [];
  }

  private getMatcher(): AhoCorasick {
    if (!this.matcher) {
      this.matcher = new AhoCorasick(this.listTerminalEntries());
    }
    return this.matcher;
  }
}
