import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Bounded } from "../lz-sequencer/dictionary/bounded.ts";
import { LZGate } from "../lz-sequencer/lz-gate.ts";
import { AsyncPipeline } from "../pipeline/async-pipeline.ts";
import { GlobFileJob } from "../pipeline/jobs/glob-file-job.ts";
import { Pipeline } from "../pipeline/pipeline.ts";
import { Queue, Sequencer } from "../sequencer/index.ts";
import type { TknConfig } from "./config.schema.ts";
import {
  closeLatticeHandle,
  openSqliteLatticeFromConfig,
  openTursoLatticeFromConfig,
} from "./open-lattice.ts";

export type RunIngestOptions = {
  config: TknConfig;
  pattern: string;
  cwd: string;
  dictMax?: number;
};

function printTopTokens(top: { pattern: string; confidence: number }[], topK: number): void {
  if (top.length === 0) return;
  console.log(`Top ${Math.min(top.length, topK)} tokens by hub score:`);
  for (const { pattern, confidence } of top) {
    console.log(`  ${JSON.stringify(pattern)}: ${confidence.toFixed(4)}`);
  }
}

export async function runIngest(options: RunIngestOptions): Promise<void> {
  const dictMax = options.dictMax ?? options.config.ingest.dictMax;
  const topK = options.config.output.topK;
  const dbPath = options.config.lattice.path;
  const backend = options.config.lattice.backend;

  await mkdir(dirname(dbPath), { recursive: true });

  const dictionary = new Bounded(dictMax);
  const sequencer = new Sequencer({
    gates: [new LZGate({ cache: dictionary })],
    queue: new Queue({ historyOptions: { bounded: false } }),
  });

  console.log(`Ingesting files matching "${options.pattern}" from ${options.cwd}`);
  console.log(`Database: ${dbPath} (${backend})`);

  if (backend === "turso") {
    const lattice = await openTursoLatticeFromConfig(options.config, { bulkIngest: true });
    try {
      const pipeline = new AsyncPipeline({ lattice, sequencer, dictionary });
      await pipeline.run(new GlobFileJob({ pattern: options.pattern, cwd: options.cwd }));

      const vocabulary = await lattice.vocabulary();
      const top = await lattice.getTopTokens(topK);
      const segments = sequencer.history.length;
      console.log(`Done. Segments: ${segments}, vocabulary size: ${vocabulary.length}`);
      printTopTokens(top, topK);

      if (segments === 0) {
        console.error(
          "Warning: no segments were emitted. Check that the glob matched files and the path is correct.",
        );
        process.exitCode = 1;
      }
    } finally {
      await closeLatticeHandle({ backend: "turso", lattice });
    }
    return;
  }

  const lattice = openSqliteLatticeFromConfig(options.config, { bulkIngest: true });
  try {
    const pipeline = new Pipeline({ lattice, sequencer, dictionary });
    await pipeline.run(new GlobFileJob({ pattern: options.pattern, cwd: options.cwd }));

    const vocabulary = lattice.vocabulary();
    const top = lattice.getTopTokens(topK);
    const segments = sequencer.history.length;
    console.log(`Done. Segments: ${segments}, vocabulary size: ${vocabulary.length}`);
    printTopTokens(top, topK);

    if (segments === 0) {
      console.error(
        "Warning: no segments were emitted. Check that the glob matched files and the path is correct.",
      );
      process.exitCode = 1;
    }
  } finally {
    await closeLatticeHandle({ backend: "sqlite", lattice });
  }
}
