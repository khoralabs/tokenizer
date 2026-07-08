import { buildLmTables, type LmTables } from "../../compiled-lattice";
import type { GraphEdgeInsert, GraphNodeInsert } from "../../graph.model";
import type { TursoDatabase } from "../db";
import {
  bindGetConfidence,
  bindGetOutgoingTotal,
  bindGetTokenCount,
  bindGetTransitionWeight,
  bindInsertEdge,
  bindRecordEmission,
  bindSelectTopTokens,
  bindSelectTransitions,
  bindUpsertNode,
  createGraphStatements,
  createGraphTables,
  type GraphStatements,
  type UpsertNodeRow,
} from "./graph.db";
import { DegreeScorer, type ITursoHubScorer } from "./scorers";

export class Graph {
  private db: TursoDatabase;
  private scorer: ITursoHubScorer;
  private nodeIdCache = new Map<string, number>();
  private statements!: GraphStatements;

  private constructor(database: TursoDatabase, scorer: ITursoHubScorer) {
    this.db = database;
    this.scorer = scorer;
  }

  static async open(
    database: TursoDatabase,
    scorer: ITursoHubScorer = new DegreeScorer(),
  ): Promise<Graph> {
    const graph = new Graph(database, scorer);
    await createGraphTables(database);
    graph.statements = await createGraphStatements(database);
    return graph;
  }

  async getOrCreateNode(pattern: string): Promise<number> {
    const cached = this.nodeIdCache.get(pattern);
    if (cached !== undefined) return cached;

    const insert: GraphNodeInsert = { pattern };
    const row = (await this.statements.upsertNode.get(...bindUpsertNode(insert))) as
      | UpsertNodeRow
      | undefined;
    if (!row) throw new Error(`Failed to get/create node for pattern: ${pattern}`);
    this.nodeIdCache.set(pattern, row.id as number);
    return row.id as number;
  }

  async merge(from: string, to: string, delta = 1): Promise<{ from_id: number; to_id: number }> {
    const from_id = await this.getOrCreateNode(from);
    const to_id = await this.getOrCreateNode(to);
    if (delta > 0) {
      const edge: GraphEdgeInsert = { from_id, to_id, weight: delta };
      await this.statements.insertEdge.run(...bindInsertEdge(edge));
    }
    return { from_id, to_id };
  }

  async mergeBatch(pairs: [string, string][]): Promise<{ from_id: number; to_id: number }[]> {
    const insertions: { from_id: number; to_id: number }[] = [];
    const tx = this.db.transaction(async () => {
      for (const [from, to] of pairs) insertions.push(await this.merge(from, to));
    });
    await tx();
    return insertions;
  }

  async getNext(from: string): Promise<{ to: string; weight: number }[]> {
    return (await this.statements.selectTransitions.all(...bindSelectTransitions(from))) as {
      to: string;
      weight: number;
    }[];
  }

  async getTopTokens(limit = 10): Promise<{ pattern: string; confidence: number }[]> {
    await this.scorer.compute(this.db);
    return (await this.statements.selectTopTokens.all(...bindSelectTopTokens({ limit }))) as {
      pattern: string;
      confidence: number;
    }[];
  }

  async listPatterns(): Promise<string[]> {
    const rows = await this.statements.listPatterns.all();
    return rows.map((row) => row.pattern as string);
  }

  async getTransitionWeight(from: string, to: string): Promise<number | null> {
    const row = await this.statements.getTransitionWeight.get(...bindGetTransitionWeight(from, to));
    return row?.weight ?? null;
  }

  async getConfidence(pattern: string): Promise<number> {
    const row = await this.statements.getConfidence.get(...bindGetConfidence(pattern));
    return row?.confidence ?? 0;
  }

  async recordEmission(pattern: string, delta = 1): Promise<void> {
    if (delta <= 0) return;
    await this.statements.recordEmission.run(...bindRecordEmission(pattern, delta));
    this.nodeIdCache.delete(pattern);
  }

  async getTokenCount(pattern: string): Promise<number> {
    const row = await this.statements.getTokenCount.get(...bindGetTokenCount(pattern));
    return (row?.token_count as number | undefined) ?? 0;
  }

  async getTotalEmissions(): Promise<number> {
    const row = await this.statements.getTotalEmissions.get();
    return (row?.total as number | undefined) ?? 0;
  }

  async getVocabSize(): Promise<number> {
    const row = await this.statements.getVocabSize.get();
    return (row?.count as number | undefined) ?? 0;
  }

  async getOutgoingTotal(from: string): Promise<number> {
    const row = await this.statements.getOutgoingTotal.get(...bindGetOutgoingTotal(from));
    return (row?.total as number | undefined) ?? 0;
  }

  async buildLmTables(): Promise<LmTables> {
    const tokenCounts = new Map<string, number>();
    const countRows = await this.statements.selectAllTokenCounts.all();
    for (const row of countRows) {
      const token = row.token as string;
      const count = row.token_count as number;
      if (count > 0) tokenCounts.set(token, count);
    }
    const edgeRows = await this.statements.selectAllLmEdges.all();
    const edges = edgeRows.map((row) => ({
      from: row.from_token as string,
      to: row.to_token as string,
      weight: row.weight as number,
    }));
    return buildLmTables(tokenCounts, edges);
  }
}
