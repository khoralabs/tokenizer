import type { TursoDatabase } from "../db";

export interface ITursoHubScorer {
  compute(db: TursoDatabase): Promise<void>;
}

/**
 * Computes local hub scores for nodes based on weighted out-degree.
 */
export class DegreeScorer implements ITursoHubScorer {
  async compute(db: TursoDatabase): Promise<void> {
    const stmt = await db.prepare(`
      UPDATE nodes
      SET hub_score = log(1 + COALESCE((
        SELECT SUM(weight) FROM edges WHERE edges.from_id = nodes.id
      ), 0))
    `);
    await stmt.run();
  }
}
