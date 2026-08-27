import { access } from "node:fs/promises";
import type { TknConfig } from "./config.schema.ts";
import {
  closeLatticeHandle,
  openSqliteLatticeFromConfig,
  openTursoLatticeFromConfig,
} from "./open-lattice.ts";

export type RunTopkOptions = {
  config: TknConfig;
  limit?: number;
  format?: "human" | "json";
};

const MAX_TOP_K = 100;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit must be a positive number");
  }
  return Math.min(limit, MAX_TOP_K);
}

export async function runTopk(options: RunTopkOptions): Promise<void> {
  const limit = clampLimit(options.limit ?? options.config.output.topK);
  const dbPath = options.config.lattice.path;
  const backend = options.config.lattice.backend;
  const format = options.format ?? "human";

  try {
    await access(dbPath);
  } catch {
    throw new Error(`Database not found: ${dbPath}`);
  }

  if (backend === "turso") {
    const lattice = await openTursoLatticeFromConfig(options.config, { readonly: true });
    try {
      const vocabulary = await lattice.vocabulary();
      const top = await lattice.getTopTokens(limit);
      printTopkOutput({ vocabularySize: vocabulary.length, top, limit, format });
    } finally {
      await closeLatticeHandle({ backend: "turso", lattice });
    }
    return;
  }

  const lattice = openSqliteLatticeFromConfig(options.config, { readonly: true });
  try {
    const vocabulary = lattice.vocabulary();
    const top = lattice.getTopTokens(limit);
    printTopkOutput({ vocabularySize: vocabulary.length, top, limit, format });
  } finally {
    await closeLatticeHandle({ backend: "sqlite", lattice });
  }
}

function printTopkOutput(options: {
  vocabularySize: number;
  top: { pattern: string; confidence: number }[];
  limit: number;
  format: "human" | "json";
}): void {
  if (options.format === "json") {
    console.log(
      JSON.stringify({
        vocabularySize: options.vocabularySize,
        top: options.top,
      }),
    );
    return;
  }

  console.log(`${options.vocabularySize} patterns`);
  for (const { pattern, confidence } of options.top) {
    console.log(`${JSON.stringify(pattern)}: ${confidence.toFixed(4)}`);
  }
}
