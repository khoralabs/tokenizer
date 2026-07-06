import { Database } from "bun:sqlite";
import {
  type DecodeSnapshot,
  loadSqliteDecodeSnapshot,
  tokenizeWithSnapshot,
} from "../decode-snapshot";
import { ingestSegmentBatch } from "../ingest-segment";
import type { ILattice } from "../lattice";
import type { LatticeSegment } from "../segment";
import type { LatticeDecodeOptions } from "../tokenize";
import { WAL_CHECKPOINT_INTERVAL } from "../wal";
import { DegreeScorer, Graph, type ISqliteHubScorer } from "./graph";
import { Trie } from "./trie";

export interface SqliteLatticeConfig {
  filename?: string;
  scorer?: ISqliteHubScorer;
  bulkIngest?: boolean;
  readonly?: boolean;
}

/**
 * Composes a Trie for token storage and a Graph for transitions.
 */
export class Lattice implements ILattice {
  private db: Database;
  private trie: Trie;
  private graph: Graph;
  private bulkIngest: boolean;
  private readonly: boolean;
  private writesSinceCheckpoint = 0;
  private decodeSnapshot: DecodeSnapshot | null = null;

  constructor(config: SqliteLatticeConfig | string = {}) {
    const {
      filename = ":memory:",
      scorer = new DegreeScorer(),
      bulkIngest = false,
      readonly = false,
    } = typeof config === "string" ? { filename: config } : config;

    this.bulkIngest = bulkIngest;
    this.readonly = readonly;
    this.db = new Database(filename, readonly ? { readonly: true } : { create: true });
    if (!readonly) {
      this.db.run("PRAGMA journal_mode = WAL;");
      this.db.run("PRAGMA synchronous = OFF;");
      this.db.run("PRAGMA temp_store = MEMORY;");
      this.db.run("PRAGMA wal_autocheckpoint = 100;");
    }

    this.graph = new Graph(this.db, scorer, readonly);
    this.trie = new Trie(this.db);
  }

  merge(pairs: [string, string, number?][]): void {
    for (const [from, to] of pairs) {
      if (from.length === 0 || to.length === 0) throw new Error("Cannot merge empty pattern");
    }
    const tx = this.db.transaction(() => {
      for (const [from, to, delta] of pairs) {
        this.graph.merge(from, to, delta);
      }
    });
    tx();
    this.invalidateDecodeSnapshot();
    this.maybeCheckpoint();
  }

  ingest(segment: LatticeSegment): void {
    this.ingestBatch([segment]);
  }

  ingestBatch(segments: LatticeSegment[]): void {
    if (segments.length === 0) return;

    const tx = this.db.transaction(() => {
      ingestSegmentBatch(this.graph, this.trie, segments);
    });
    tx();
    this.invalidateDecodeSnapshot();
    this.maybeCheckpoint();
  }

  commitFeedBatch(segments: LatticeSegment[], pairs: [string, string, number?][]): void {
    if (segments.length === 0 && pairs.length === 0) return;

    const tx = this.db.transaction(() => {
      ingestSegmentBatch(this.graph, this.trie, segments);
      for (const [from, to, delta] of pairs) {
        this.graph.merge(from, to, delta);
      }
    });
    tx();
    this.invalidateDecodeSnapshot();
    this.maybeCheckpoint();
  }

  tokenize(text: string, options?: LatticeDecodeOptions): string[] {
    return tokenizeWithSnapshot(text, this.getDecodeSnapshot(), options);
  }

  /** Drop cached in-memory decode tables (call after ingest if re-tokenizing same instance). */
  invalidateDecodeSnapshot(): void {
    this.decodeSnapshot = null;
  }

  private getDecodeSnapshot(): DecodeSnapshot {
    if (!this.decodeSnapshot) {
      this.decodeSnapshot = loadSqliteDecodeSnapshot(this.db);
    }
    return this.decodeSnapshot;
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
    if (!this.readonly) {
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE);");
    }
    this.db.close();
  }

  private maybeCheckpoint(): void {
    if (this.bulkIngest) return;
    this.writesSinceCheckpoint++;
    if (this.writesSinceCheckpoint >= WAL_CHECKPOINT_INTERVAL) {
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE);");
      this.writesSinceCheckpoint = 0;
    }
  }
}
