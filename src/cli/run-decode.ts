import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LatticeDecodeOptions } from "../lattice/tokenize.ts";
import type { TknConfig } from "./config.schema.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import {
  closeLatticeHandle,
  openSqliteLatticeFromConfig,
  openTursoLatticeFromConfig,
} from "./open-lattice.ts";

export type RunDecodeOptions = {
  config: TknConfig;
  input: string;
  decode?: LatticeDecodeOptions;
  format?: string;
  verbose?: boolean;
  quiet?: boolean;
};

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

export function parseDecoder(
  decoder: string,
  beamWidthRaw: string | undefined,
  defaultBeamWidth: number,
): LatticeDecodeOptions {
  if (decoder === "viterbi") return { mode: "viterbi" };

  if (decoder === "beam") {
    const beamWidth = Number(beamWidthRaw ?? defaultBeamWidth);
    if (!Number.isFinite(beamWidth) || beamWidth <= 0) {
      throw new Error("--beam-width must be a positive number");
    }
    return { mode: "beam", beamWidth };
  }

  throw new Error("--decoder must be viterbi or beam");
}

export function normalizeInput(text: string): string {
  return text.trimEnd();
}

export async function readDecodeInput(text?: string, file?: string): Promise<string> {
  if (text !== undefined) return normalizeInput(text);
  if (file !== undefined)
    return normalizeInput(await readFile(resolve(process.cwd(), file), "utf8"));

  if (!process.stdin.isTTY) {
    const piped = await Bun.stdin.text();
    if (piped.length > 0) return normalizeInput(piped);
  }

  throw new Error("Provide --text / -t, --file / -f, or pipe input via stdin");
}

export async function runDecode(options: RunDecodeOptions): Promise<void> {
  const dbPath = options.config.lattice.path;
  const backend = options.config.lattice.backend;
  const decode =
    options.decode ??
    parseDecoder(
      options.config.decode.decoder,
      String(options.config.decode.beamWidth),
      options.config.decode.beamWidth,
    );
  const format = options.format ?? "json";
  const verbose = options.verbose ?? false;
  const quiet = options.quiet ?? false;

  try {
    await access(dbPath);
  } catch {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const decoderLabel = decode.mode === "beam" ? `beam (width ${decode.beamWidth})` : "viterbi";

  if (backend === "turso") {
    const lattice = await openTursoLatticeFromConfig(options.config, { readonly: true });
    try {
      const vocabSize = (await lattice.vocabulary()).length;
      if (vocabSize === 0) {
        throw new Error(`Lattice at ${dbPath} has no patterns — run ingest first`);
      }

      const tokens = await lattice.tokenize(options.input, decode);
      if (!quiet) {
        console.error(`Using ${dbPath} (${vocabSize} patterns, ${backend})`);
      }
      if (verbose) {
        printVerbose({
          dbPath,
          backend,
          decoder: decoderLabel,
          vocabSize,
          inputLength: options.input.length,
          tokenCount: tokens.length,
        });
      }
      printTokens(tokens, format);
    } finally {
      await closeLatticeHandle({ backend: "turso", lattice });
    }
    return;
  }

  const lattice = openSqliteLatticeFromConfig(options.config, { readonly: true });
  try {
    const vocabSize = lattice.vocabulary().length;
    if (vocabSize === 0) {
      throw new Error(`Lattice at ${dbPath} has no patterns — run ingest first`);
    }

    const tokens = lattice.tokenize(options.input, decode);
    if (!quiet) {
      console.error(`Using ${dbPath} (${vocabSize} patterns, ${backend})`);
    }
    if (verbose) {
      printVerbose({
        dbPath,
        backend,
        decoder: decoderLabel,
        vocabSize,
        inputLength: options.input.length,
        tokenCount: tokens.length,
      });
    }
    printTokens(tokens, format);
  } finally {
    await closeLatticeHandle({ backend: "sqlite", lattice });
  }
}

export type DecodeCliOverrides = {
  text?: string;
  file?: string;
  db?: string;
  decoder?: string;
  beamWidth?: string;
  format?: string;
  verbose?: boolean;
  quiet?: boolean;
};

export async function runDecodeFromCli(
  config: TknConfig,
  overrides: DecodeCliOverrides,
): Promise<void> {
  const decoder = overrides.decoder ?? config.decode.decoder;
  const format = overrides.format ?? "json";
  if (format !== "json" && format !== "lines") {
    throw new Error("--format must be json or lines");
  }

  const input = await readDecodeInput(overrides.text, overrides.file);
  const decode = parseDecoder(decoder, overrides.beamWidth, config.decode.beamWidth);

  await runDecode({
    config,
    input,
    decode,
    format,
    verbose: overrides.verbose ?? false,
    quiet: overrides.quiet ?? false,
  });
}

export const DEFAULT_DECODE_FORMAT = "json";
export const DEFAULT_DECODER = DEFAULT_CONFIG.decode.decoder;
export const DEFAULT_BEAM_WIDTH = DEFAULT_CONFIG.decode.beamWidth;
