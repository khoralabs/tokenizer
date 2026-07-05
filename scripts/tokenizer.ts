#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
process.chdir(projectRoot);

const DEFAULT_DB = ".tkn/lattice.db";
const DEFAULT_DICT_MAX = 10_000;
const DEFAULT_BACKEND = "sqlite";

function printUsage(): void {
  console.log(`Usage: tokenizer ingest -f <glob> [options]

Options:
  -f, --files <glob>     Glob pattern of files to ingest (required)
  --db <path>            Database path (default: ${DEFAULT_DB})
  --backend <name>       Storage backend: sqlite or turso (default: ${DEFAULT_BACKEND})
  --dict-max <n>         Bounded dictionary capacity (default: ${DEFAULT_DICT_MAX})
  --cwd <path>           Directory for glob resolution (default: project root)
  -h, --help             Show this help
`);
}

async function ingest(options: {
  pattern: string;
  dbPath: string;
  backend: "sqlite" | "turso";
  dictMax: number;
  cwd: string;
}): Promise<void> {
  await mkdir(dirname(options.dbPath), { recursive: true });

  const dictionary = new Bounded(options.dictMax);
  const sequencer = new Sequencer({
    gates: [new LZGate({ cache: dictionary })],
    queue: new Queue({ historyOptions: { bounded: false } }),
  });

  console.log(`Ingesting files matching "${options.pattern}" from ${options.cwd}`);
  console.log(`Database: ${options.dbPath} (${options.backend})`);

  if (options.backend === "turso") {
    const lattice = await TursoLattice.open({ filename: options.dbPath, bulkIngest: true });
    const pipeline = new AsyncPipeline({ lattice, sequencer, dictionary });
    await pipeline.run(new GlobFileJob({ pattern: options.pattern, cwd: options.cwd }));

    const vocabulary = await lattice.vocabulary();
    const top = await lattice.getTopTokens(5);
    const segments = sequencer.history.length;
    console.log(`Done. Segments: ${segments}, vocabulary size: ${vocabulary.length}`);
    if (top.length > 0) {
      console.log("Top tokens by hub score:");
      for (const { pattern, confidence } of top) {
        console.log(`  ${JSON.stringify(pattern)}: ${confidence.toFixed(4)}`);
      }
    }

    if (segments === 0) {
      console.error(
        "Warning: no segments were emitted. Check that the glob matched files and the path is correct.",
      );
      process.exitCode = 1;
    }

    await lattice.close();
    return;
  }

  const lattice = new SqliteLattice({ filename: options.dbPath, bulkIngest: true });
  const pipeline = new Pipeline({ lattice, sequencer, dictionary });
  await pipeline.run(new GlobFileJob({ pattern: options.pattern, cwd: options.cwd }));

  const vocabulary = lattice.vocabulary();
  const top = lattice.getTopTokens(5);
  const segments = sequencer.history.length;
  console.log(`Done. Segments: ${segments}, vocabulary size: ${vocabulary.length}`);
  if (top.length > 0) {
    console.log("Top tokens by hub score:");
    for (const { pattern, confidence } of top) {
      console.log(`  ${JSON.stringify(pattern)}: ${confidence.toFixed(4)}`);
    }
  }

  if (segments === 0) {
    console.error(
      "Warning: no segments were emitted. Check that the glob matched files and the path is correct.",
    );
    process.exitCode = 1;
  }

  lattice.close();
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      files: { type: "string", short: "f" },
      db: { type: "string" },
      backend: { type: "string" },
      "dict-max": { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    return;
  }

  const [command] = positionals;
  if (command !== "ingest") {
    printUsage();
    process.exit(1);
  }

  const pattern = values.files;
  if (!pattern) {
    console.error("Error: --files / -f <glob> is required\n");
    printUsage();
    process.exit(1);
  }

  const backend = values.backend ?? DEFAULT_BACKEND;
  if (backend !== "sqlite" && backend !== "turso") {
    console.error("Error: --backend must be sqlite or turso");
    process.exit(1);
  }

  const dictMax = Number(values["dict-max"] ?? DEFAULT_DICT_MAX);
  if (!Number.isFinite(dictMax) || dictMax <= 0) {
    console.error("Error: --dict-max must be a positive number");
    process.exit(1);
  }

  const dbPath = resolve(projectRoot, values.db ?? DEFAULT_DB);
  const cwd = resolve(projectRoot, values.cwd ?? ".");

  await ingest({ pattern, dbPath, backend, dictMax, cwd });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
