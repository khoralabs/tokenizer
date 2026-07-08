import { compilePatterns, type ICompiledLattice, tokenizeCompiled } from "../compiled-lattice";
import { ingestSegmentBatch } from "../ingest-segment";
import type { ILattice } from "../lattice";
import { PatternVocabulary } from "../pattern-vocabulary";
import type { LatticeSegment } from "../segment";
import type { LatticeDecodeOptions } from "../tokenize";
import { Graph } from "./graph";
import { DegreeScorer, type IMemoryHubScorer } from "./scorers";

export interface MemoryLatticeConfig {
  scorer?: IMemoryHubScorer;
}

/**
 * In-memory lattice: graph transitions + Aho-Corasick vocabulary.
 */
export class Lattice implements ILattice {
  private graph: Graph;
  private patterns: PatternVocabulary;
  private compiled: ICompiledLattice | null = null;

  constructor(config: MemoryLatticeConfig = {}) {
    const { scorer = new DegreeScorer() } = config;
    this.graph = new Graph(scorer);
    this.patterns = new PatternVocabulary();
  }

  merge(pairs: [string, string, number?][]): void {
    for (const [from, to, delta] of pairs) {
      if (from.length === 0 || to.length === 0) throw new Error("Cannot merge empty pattern");
      this.graph.merge(from, to, delta);
    }
    this.invalidateCompiled();
  }

  ingest(segment: LatticeSegment): void {
    this.ingestBatch([segment]);
  }

  ingestBatch(segments: LatticeSegment[]): void {
    ingestSegmentBatch(this.graph, this.patterns, segments);
    this.invalidateCompiled();
  }

  commitFeedBatch(segments: LatticeSegment[], pairs: [string, string, number?][]): void {
    ingestSegmentBatch(this.graph, this.patterns, segments);
    this.merge(pairs);
  }

  compile(): ICompiledLattice {
    return compilePatterns(this.patterns.listTerminalPatterns(), this.graph.buildLmTables());
  }

  tokenize(text: string, options?: LatticeDecodeOptions): string[] {
    return tokenizeCompiled(text, this.getCompiled(), options);
  }

  vocabulary(): string[] {
    return this.graph.listPatterns();
  }

  getNext(from: string): { to: string; weight: number }[] {
    return this.graph.getNext(from);
  }

  nextCharacters(prefix: string): string[] {
    return this.patterns.nextCharacters(prefix);
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
    // No-op for in-memory implementation
  }

  invalidateCompiled(): void {
    this.compiled = null;
    this.patterns.invalidate();
  }

  private getCompiled(): ICompiledLattice {
    if (!this.compiled) {
      this.compiled = this.compile();
    }
    return this.compiled;
  }
}
