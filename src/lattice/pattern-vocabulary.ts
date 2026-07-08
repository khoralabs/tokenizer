import { AhoCorasick } from "./aho-corasick";
import type { ITrie, MatchCandidate } from "./trie";

/** In-memory vocabulary backed by Aho-Corasick for pattern matching. */
export class PatternVocabulary implements ITrie {
  private patterns = new Set<string>();
  private matcher: AhoCorasick | null = null;

  merge(token: string, _markov_id: number): number {
    if (token.length === 0) throw new Error("Cannot merge empty pattern");
    this.patterns.add(token);
    this.matcher = null;
    return 0;
  }

  list(): string[] {
    return [...this.patterns];
  }

  listTerminalPatterns(): string[] {
    return this.list();
  }

  invalidate(): void {
    this.matcher = null;
  }

  nextCharacters(prefix: string): string[] {
    const chars = new Set<string>();
    for (const pattern of this.patterns) {
      if (!pattern.startsWith(prefix)) continue;
      const next = pattern[prefix.length];
      if (next !== undefined) chars.add(next);
    }
    return [...chars];
  }

  matchCandidates(text: string, offset = 0): MatchCandidate[] {
    return this.getMatcher().matchStarts(text)[offset] ?? [];
  }

  private getMatcher(): AhoCorasick {
    if (!this.matcher) {
      this.matcher = new AhoCorasick(this.patterns);
    }
    return this.matcher;
  }
}
