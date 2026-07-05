import type { TursoDatabase } from "../db";
import { createGraphStatements, createGraphTables, type GraphStatements } from "./graph.db";
import { DegreeScorer, type ITursoHubScorer } from "./scorers";

export class Graph {
  private db: TursoDatabase;
  private scorer: ITursoHubScorer;
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
    await this.statements.insertNode.run(pattern);
    const row = await this.statements.selectNodeId.get(pattern);
    if (!row) throw new Error(`Failed to get/create node for pattern: ${pattern}`);
    return row.id as number;
  }

  async merge(from: string, to: string): Promise<{ from_id: number; to_id: number }> {
    const from_id = await this.getOrCreateNode(from);
    const to_id = await this.getOrCreateNode(to);
    await this.statements.insertEdge.run(from_id, to_id);
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
    return (await this.statements.selectTransitions.all(from)) as {
      to: string;
      weight: number;
    }[];
  }

  async getTopTokens(limit = 10): Promise<{ pattern: string; confidence: number }[]> {
    await this.scorer.compute(this.db);
    return (await this.statements.selectTopTokens.all(limit)) as {
      pattern: string;
      confidence: number;
    }[];
  }
}
