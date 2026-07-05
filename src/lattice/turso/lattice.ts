import type { IAsyncLattice } from "../lattice";
import { connectTurso, type TursoDatabase } from "./db";
import { DegreeScorer, Graph, type ITursoHubScorer } from "./graph";
import { Trie } from "./trie";

export interface TursoLatticeConfig {
  filename?: string;
  scorer?: ITursoHubScorer;
}

/**
 * Turso-backed lattice using @tursodatabase/database.
 */
export class Lattice implements IAsyncLattice {
  private db: TursoDatabase;
  private trie: Trie;
  private graph: Graph;

  private constructor(db: TursoDatabase, graph: Graph, trie: Trie) {
    this.db = db;
    this.graph = graph;
    this.trie = trie;
  }

  static async open(config: TursoLatticeConfig | string = {}): Promise<Lattice> {
    const { filename = ":memory:", scorer = new DegreeScorer() } =
      typeof config === "string" ? { filename: config } : config;

    const db = await connectTurso(filename);
    const graph = await Graph.open(db, scorer);
    const trie = await Trie.open(db);
    return new Lattice(db, graph, trie);
  }

  async merge(pairs: [string, string][]): Promise<void> {
    const tx = this.db.transaction(async () => {
      for (const [from, to] of pairs) {
        const { from_id, to_id } = await this.graph.merge(from, to);
        await this.trie.merge(from, from_id);
        await this.trie.merge(to, to_id);
      }
    });
    await tx();
  }

  async getNext(from: string): Promise<{ to: string; weight: number }[]> {
    return this.graph.getNext(from);
  }

  async nextCharacters(prefix: string): Promise<string[]> {
    return this.trie.nextCharacters(prefix);
  }

  async getTopTokens(limit = 10): Promise<{ pattern: string; confidence: number }[]> {
    return this.graph.getTopTokens(limit);
  }

  async pipe(
    source: AsyncGenerator<{ key: string; sequence: string[] }, void, unknown>,
    batchSize = 1000,
  ): Promise<void> {
    const batch: [string, string][] = [];
    let previousPattern: string | null = null;

    for await (const segment of source) {
      const currentPattern = segment.key;
      const currentMarkovId = await this.graph.getOrCreateNode(currentPattern);

      for (const element of segment.sequence) {
        await this.trie.merge(element, currentMarkovId);
      }

      if (previousPattern !== null) {
        batch.push([previousPattern, currentPattern]);

        if (batch.length >= batchSize) {
          await this.merge(batch.splice(0, batchSize));
        }
      }

      previousPattern = currentPattern;
    }

    if (batch.length > 0) {
      await this.merge(batch.splice(0));
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
