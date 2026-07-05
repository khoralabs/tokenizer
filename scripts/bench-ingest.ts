#!/usr/bin/env bun

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Lattice as SqliteLattice } from "../src/lattice/sqlite/lattice";
import { Lattice as TursoLattice } from "../src/lattice/turso/lattice";
import { Bounded } from "../src/lz-sequencer/dictionary/bounded";
import { LZGate } from "../src/lz-sequencer/lz-gate";
import { AsyncPipeline } from "../src/pipeline/async-pipeline";
import { GlobFileJob } from "../src/pipeline/jobs/glob-file-job";
import { Pipeline } from "../src/pipeline/pipeline";
import { Queue, Sequencer } from "../src/sequencer";

const projectRoot = resolve(import.meta.dir, "..");
const DEFAULT_FILE = resolve(projectRoot, ".llm-context/combined_codebase_2026-07-05T05-53-15.txt");

function dbSize(path: string): { db: number; wal: number } {
  try {
    return {
      db: statSync(path).size,
      wal: statSync(`${path}-wal`).size,
    };
  } catch {
    return { db: 0, wal: 0 };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function benchSqlite(file: string): Promise<{
  ms: number;
  segments: number;
  vocab: number;
  db: number;
  wal: number;
}> {
  const dbPath = `/tmp/bench-ingest-sqlite-${Date.now()}.db`;
  const dictionary = new Bounded(10_000);
  const lattice = new SqliteLattice({ filename: dbPath, bulkIngest: true });
  const sequencer = new Sequencer({
    gates: [new LZGate({ cache: dictionary })],
    queue: new Queue({ historyOptions: { bounded: false } }),
  });
  const pipeline = new Pipeline({ lattice, sequencer, dictionary });

  const t0 = performance.now();
  await pipeline.run(new GlobFileJob({ pattern: file, cwd: projectRoot }));
  const ms = performance.now() - t0;

  const segments = sequencer.history.length;
  const vocab = lattice.vocabulary().length;
  lattice.close();

  const sizes = dbSize(dbPath);
  return { ms, segments, vocab, db: sizes.db, wal: sizes.wal };
}

async function benchTurso(file: string): Promise<{
  ms: number;
  segments: number;
  vocab: number;
  db: number;
  wal: number;
}> {
  const dbPath = `/tmp/bench-ingest-turso-${Date.now()}.db`;
  const dictionary = new Bounded(10_000);
  const lattice = await TursoLattice.open({ filename: dbPath, bulkIngest: true });
  const sequencer = new Sequencer({
    gates: [new LZGate({ cache: dictionary })],
    queue: new Queue({ historyOptions: { bounded: false } }),
  });
  const pipeline = new AsyncPipeline({ lattice, sequencer, dictionary });

  const t0 = performance.now();
  await pipeline.run(new GlobFileJob({ pattern: file, cwd: projectRoot }));
  const ms = performance.now() - t0;

  const segments = sequencer.history.length;
  const vocab = (await lattice.vocabulary()).length;
  await lattice.close();

  const sizes = dbSize(dbPath);
  return { ms, segments, vocab, db: sizes.db, wal: sizes.wal };
}

function printResult(label: string, r: Awaited<ReturnType<typeof benchSqlite>>): void {
  const rate = r.segments > 0 ? (r.segments / (r.ms / 1000)).toFixed(0) : "0";
  console.log(`${label}:`);
  console.log(`  time:     ${r.ms.toFixed(0)} ms`);
  console.log(`  segments: ${r.segments} (${rate}/s)`);
  console.log(`  vocab:    ${r.vocab}`);
  console.log(`  db:       ${formatBytes(r.db)} (wal: ${formatBytes(r.wal)})`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string", short: "f" },
      backend: { type: "string" },
    },
  });

  const file = values.file ?? DEFAULT_FILE;

  if (values.backend === "sqlite" || !values.backend) {
    printResult("sqlite", await benchSqlite(file));
  }
  if (values.backend === "turso" || !values.backend) {
    printResult("turso", await benchTurso(file));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
