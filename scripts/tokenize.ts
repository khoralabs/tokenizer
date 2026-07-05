#!/usr/bin/env bun

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Lattice as SqliteLattice } from "../src/lattice/sqlite/lattice";
import type { LatticeDecodeOptions } from "../src/lattice/tokenize";
import { Lattice as TursoLattice } from "../src/lattice/turso/lattice";

const projectRoot = resolve(import.meta.dir, "..");
process.chdir(projectRoot);

const DEFAULT_DB = ".tkn/lattice.db";
const DEFAULT_BACKEND = "sqlite";
const DEFAULT_DECODER = "viterbi";
const DEFAULT_BEAM_WIDTH = 32;

function printUsage(): void {
  console.log(`Usage: tokenize [options]

Decode input text using a trained lattice.

Input (one required):
  -t, --text <string>    Text to tokenize
  -f, --file <path>      Read text from a file
                         (or pipe text via stdin)

Lattice:
  --db <path>            Database path (default: ${DEFAULT_DB})
  --backend <name>       sqlite or turso (default: ${DEFAULT_BACKEND})

Decoder:
  --decoder <name>       viterbi or beam (default: ${DEFAULT_DECODER})
  --beam-width <n>       Beam width when --decoder beam (default: ${DEFAULT_BEAM_WIDTH})

Output:
  --format <name>        json or lines (default: json)
  -v, --verbose          Print lattice stats to stderr
  -h, --help             Show this help
`);
}

function normalizeInput(text: string): string {
  return text.trimEnd();
}

async function readInput(text?: string, file?: string): Promise<string> {
  if (text !== undefined) return normalizeInput(text);
  if (file !== undefined) return normalizeInput(await readFile(resolve(projectRoot, file), "utf8"));

  if (!process.stdin.isTTY) {
    const piped = await Bun.stdin.text();
    if (piped.length > 0) return normalizeInput(piped);
  }

  throw new Error("Provide --text / -t, --file / -f, or pipe input via stdin");
}

function parseDecoder(decoder: string, beamWidthRaw: string | undefined): LatticeDecodeOptions {
  if (decoder === "viterbi") return { mode: "viterbi" };

  if (decoder === "beam") {
    const beamWidth = Number(beamWidthRaw ?? DEFAULT_BEAM_WIDTH);
    if (!Number.isFinite(beamWidth) || beamWidth <= 0) {
      throw new Error("--beam-width must be a positive number");
    }
    return { mode: "beam", beamWidth };
  }

  throw new Error("--decoder must be viterbi or beam");
}

function printTokens(tokens: string[], format: string): void {
  if (format === "lines") {
    for (const token of tokens) console.log(token);
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify(tokens));
    return;
  }
  throw new Error("--format must be json or lines");
}

function printVerbose(options: {
  dbPath: string;
  backend: string;
  decoder: string;
  vocabSize: number;
  inputLength: number;
  tokenCount: number;
}): void {
  console.error(
    `Lattice: ${options.dbPath} (${options.backend}, ${options.vocabSize} patterns)\n` +
      `Decoder: ${options.decoder}, input: ${options.inputLength} chars → ${options.tokenCount} tokens`,
  );
}

async function tokenize(options: {
  input: string;
  dbPath: string;
  backend: "sqlite" | "turso";
  decode: LatticeDecodeOptions;
  format: string;
  verbose: boolean;
}): Promise<void> {
  try {
    await access(options.dbPath);
  } catch {
    throw new Error(`Database not found: ${options.dbPath}`);
  }

  const decoderLabel =
    options.decode.mode === "beam" ? `beam (width ${options.decode.beamWidth})` : "viterbi";

  if (options.backend === "turso") {
    const lattice = await TursoLattice.open(options.dbPath);
    try {
      const vocabSize = (await lattice.vocabulary()).length;
      if (vocabSize === 0) {
        throw new Error(`Lattice at ${options.dbPath} has no patterns — run ingest first`);
      }

      const tokens = await lattice.tokenize(options.input, options.decode);
      console.error(`Using ${options.dbPath} (${vocabSize} patterns, ${options.backend})`);
      if (options.verbose) {
        printVerbose({
          dbPath: options.dbPath,
          backend: options.backend,
          decoder: decoderLabel,
          vocabSize,
          inputLength: options.input.length,
          tokenCount: tokens.length,
        });
      }
      printTokens(tokens, options.format);
    } finally {
      await lattice.close();
    }
    return;
  }

  const lattice = new SqliteLattice({ filename: options.dbPath, readonly: true });
  try {
    const vocabSize = lattice.vocabulary().length;
    if (vocabSize === 0) {
      throw new Error(`Lattice at ${options.dbPath} has no patterns — run ingest first`);
    }

    const tokens = lattice.tokenize(options.input, options.decode);
    console.error(`Using ${options.dbPath} (${vocabSize} patterns, ${options.backend})`);
    if (options.verbose) {
      printVerbose({
        dbPath: options.dbPath,
        backend: options.backend,
        decoder: decoderLabel,
        vocabSize,
        inputLength: options.input.length,
        tokenCount: tokens.length,
      });
    }
    printTokens(tokens, options.format);
  } finally {
    lattice.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      text: { type: "string", short: "t" },
      file: { type: "string", short: "f" },
      db: { type: "string" },
      backend: { type: "string" },
      decoder: { type: "string" },
      "beam-width": { type: "string" },
      format: { type: "string" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printUsage();
    return;
  }

  const backend = values.backend ?? DEFAULT_BACKEND;
  if (backend !== "sqlite" && backend !== "turso") {
    console.error("Error: --backend must be sqlite or turso");
    process.exit(1);
  }

  const decoder = values.decoder ?? DEFAULT_DECODER;
  const format = values.format ?? "json";
  if (format !== "json" && format !== "lines") {
    console.error("Error: --format must be json or lines");
    process.exit(1);
  }

  let input: string;
  let decode: LatticeDecodeOptions;
  try {
    input = await readInput(values.text, values.file);
    decode = parseDecoder(decoder, values["beam-width"]);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    printUsage();
    process.exit(1);
  }

  const dbPath = resolve(projectRoot, values.db ?? DEFAULT_DB);

  await tokenize({
    input,
    dbPath,
    backend,
    decode,
    format,
    verbose: values.verbose ?? false,
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
