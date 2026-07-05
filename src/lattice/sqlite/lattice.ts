import { Database } from "bun:sqlite";
import type { ILattice } from "../lattice";
import type { LatticeSegment } from "../segment";
import { createViterbiContext, viterbiDecode } from "../tokenize";
import { DegreeScorer, Graph, type ISqliteHubScorer } from "./graph";
import { Trie } from "./trie";

export interface SqliteLatticeConfig {
  filename?: string;
  scorer?: ISqliteHubScorer;
}

/**
 * Composes a Trie for token storage and a Graph for transitions.
 */
export class Lattice implements ILattice {
  private db: Database;
  private trie: Trie;
  private graph: Graph;

  constructor(config: SqliteLatticeConfig | string = {}) {
    const { filename = ":memory:", scorer = new DegreeScorer() } =
      typeof config === "string" ? { filename: config } : config;

    this.db = new Database(filename, { create: true });
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = OFF;");
    this.db.run("PRAGMA temp_store = MEMORY;");

    this.graph = new Graph(this.db, scorer);
    this.trie = new Trie(this.db);
  }

  merge(pairs: [string, string][]): void {
    const tx = this.db.transaction(() => {
      for (const [from, to] of pairs) {
        const { from_id, to_id } = this.graph.merge(from, to);
        this.trie.merge(from, from_id);
        this.trie.merge(to, to_id);
      }
    });
    tx();
  }

  ingest(segment: LatticeSegment): void {
    const markovId = this.graph.getOrCreateNode(segment.key);
    for (const element of segment.sequence) {
      this.trie.merge(element, markovId);
    }
    this.trie.merge(segment.key, markovId);
  }

  tokenize(text: string): string[] {
    this.graph.getTopTokens(1);
    const ctx = createViterbiContext({
      matchCandidates: (input, offset) => this.trie.matchCandidates(input, offset),
      getTransitionWeight: (from, to) => this.graph.getTransitionWeight(from, to),
      getConfidence: (pattern) => this.graph.getConfidence(pattern),
    });
    return viterbiDecode(text, ctx);
  }

  vocabulary(): string[] {
    return this.graph.listPatterns();
  }

  getNext(from: string): { to: string; weight: number }[] {
    return this.graph.getNext(from);
  }

  nextCharacters(prefix: string): string[] {
    return this.trie.nextCharacters(prefix);
  }

  getTopTokens(limit = 10): { pattern: string; confidence: number }[] {
    return this.graph.getTopTokens(limit);
  }

  async pipe(
    source: AsyncGenerator<LatticeSegment, void, unknown>,
    batchSize = 1000,
  ): Promise<void> {
    const batch: [string, string][] = [];
    let previousPattern: string | null = null;

    for await (const segment of source) {
      this.ingest(segment);

      if (previousPattern !== null) {
        batch.push([previousPattern, segment.key]);

        if (batch.length >= batchSize) {
          this.merge(batch.splice(0, batchSize));
        }
      }

      previousPattern = segment.key;
    }

    if (batch.length > 0) {
      this.merge(batch.splice(0));
    }
  }

  close(): void {
    this.db.close();
  }
}
