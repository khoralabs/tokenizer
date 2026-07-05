import { ingestSegmentBatchAsync } from "../ingest-segment";
import type { IAsyncLattice } from "../lattice";
import type { LatticeSegment } from "../segment";
import type { LatticeDecodeOptions } from "../tokenize";
import { createAsyncViterbiContext, decodeAsync } from "../tokenize";
import { WAL_CHECKPOINT_INTERVAL } from "../wal";
import { checkpointWal, connectTurso, type TursoDatabase } from "./db";
import { DegreeScorer, Graph, type ITursoHubScorer } from "./graph";
import { Trie } from "./trie";

export interface TursoLatticeConfig {
  filename?: string;
  scorer?: ITursoHubScorer;
  bulkIngest?: boolean;
}

/**
 * Turso-backed lattice using @tursodatabase/database.
 */
export class Lattice implements IAsyncLattice {
  private db: TursoDatabase;
  private trie: Trie;
  private graph: Graph;
  private bulkIngest: boolean;
  private writesSinceCheckpoint = 0;

  private constructor(db: TursoDatabase, graph: Graph, trie: Trie, bulkIngest: boolean) {
    this.db = db;
    this.graph = graph;
    this.trie = trie;
    this.bulkIngest = bulkIngest;
  }

  static async open(config: TursoLatticeConfig | string = {}): Promise<Lattice> {
    const {
      filename = ":memory:",
      scorer = new DegreeScorer(),
      bulkIngest = false,
    } = typeof config === "string" ? { filename: config } : config;

    const db = await connectTurso(filename);
    const graph = await Graph.open(db, scorer);
    const trie = await Trie.open(db);
    return new Lattice(db, graph, trie, bulkIngest);
  }

  async merge(pairs: [string, string, number?][]): Promise<void> {
    for (const [from, to] of pairs) {
      if (from.length === 0 || to.length === 0) throw new Error("Cannot merge empty pattern");
    }
    const tx = this.db.transaction(async () => {
      for (const [from, to, delta] of pairs) {
        await this.graph.merge(from, to, delta);
      }
    });
    await tx();
    await this.maybeCheckpoint();
  }

  async ingest(segment: LatticeSegment): Promise<void> {
    await this.ingestBatch([segment]);
  }

  async ingestBatch(segments: LatticeSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const tx = this.db.transaction(async () => {
      await ingestSegmentBatchAsync(this.graph, this.trie, segments);
    });
    await tx();
    await this.maybeCheckpoint();
  }

  async commitFeedBatch(
    segments: LatticeSegment[],
    pairs: [string, string, number?][],
  ): Promise<void> {
    if (segments.length === 0 && pairs.length === 0) return;

    const tx = this.db.transaction(async () => {
      await ingestSegmentBatchAsync(this.graph, this.trie, segments);
      for (const [from, to, delta] of pairs) {
        await this.graph.merge(from, to, delta);
      }
    });
    await tx();
    await this.maybeCheckpoint();
  }

  private async maybeCheckpoint(): Promise<void> {
    if (this.bulkIngest) return;
    this.writesSinceCheckpoint++;
    if (this.writesSinceCheckpoint >= WAL_CHECKPOINT_INTERVAL) {
      await checkpointWal(this.db);
      this.writesSinceCheckpoint = 0;
    }
  }

  async tokenize(text: string, options?: LatticeDecodeOptions): Promise<string[]> {
    const ctx = createAsyncViterbiContext({
      matchCandidates: (input, offset) => this.trie.matchCandidates(input, offset),
      getTokenCount: (pattern) => this.graph.getTokenCount(pattern),
      getTotalEmissions: () => this.graph.getTotalEmissions(),
      getVocabSize: () => this.graph.getVocabSize(),
      getTransitionWeight: (from, to) => this.graph.getTransitionWeight(from, to),
      getOutgoingTotal: (from) => this.graph.getOutgoingTotal(from),
    });
    return decodeAsync(text, ctx, options);
  }

  async vocabulary(): Promise<string[]> {
    return this.graph.listPatterns();
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
    source: AsyncGenerator<LatticeSegment, void, unknown>,
    batchSize = 1000,
  ): Promise<void> {
    const batch: [string, string][] = [];
    let previousPattern: string | null = null;

    for await (const segment of source) {
      await this.ingest(segment);

      if (previousPattern !== null) {
        batch.push([previousPattern, segment.key]);

        if (batch.length >= batchSize) {
          await this.merge(batch.splice(0, batchSize));
        }
      }

      previousPattern = segment.key;
    }

    if (batch.length > 0) {
      await this.merge(batch.splice(0));
    }
  }

  async close(): Promise<void> {
    await checkpointWal(this.db);
    await this.db.close();
  }
}
