import type { IHubScorer } from "../../scorer";
import type { TursoDatabase } from "../db";

export interface ITursoHubScorer extends IHubScorer<TursoDatabase> {}

/**
 * Computes local hub scores for nodes based on weighted out-degree.
 */
export class DegreeScorer implements ITursoHubScorer {
  private stmt?: Awaited<ReturnType<TursoDatabase["prepare"]>>;

  async compute(db: TursoDatabase): Promise<void> {
    if (!this.stmt) {
      this.stmt = await db.prepare(`
        UPDATE nodes
        SET hub_score = log(1 + COALESCE((
          SELECT SUM(weight) FROM edges WHERE edges.from_id = nodes.id
        ), 0))
      `);
    }
    await this.stmt.run();
  }
}
