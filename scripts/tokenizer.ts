#!/usr/bin/env bun

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyDbOverride, loadConfig } from "../src/cli/config.ts";
import { runDecodeFromCli } from "../src/cli/run-decode.ts";
import { runIngest } from "../src/cli/run-ingest.ts";
import { printDecodeUsage, printIngestUsage, printTokenizerUsage } from "../src/cli/usage.ts";

const SUBCOMMANDS = ["ingest", "tokenize"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function parseSubcommand(argv: string[]): { command: Subcommand; rest: string[] } | undefined {
  if (argv.length === 0) return undefined;
  const command = argv[0];
  if (!SUBCOMMANDS.includes(command as Subcommand)) return undefined;
  return { command: command as Subcommand, rest: argv.slice(1) };
}

async function runTokenizeCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      text: { type: "string", short: "t" },
      file: { type: "string", short: "f" },
      db: { type: "string" },
      decoder: { type: "string" },
      "beam-width": { type: "string" },
      format: { type: "string" },
      verbose: { type: "boolean", short: "v" },
      quiet: { type: "boolean", short: "q" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printDecodeUsage();
    return;
  }

  const cwd = process.cwd();
  let config = await loadConfig({ cwd });
  config = applyDbOverride(config, values.db, cwd);

  await runDecodeFromCli(config, {
    text: values.text,
    file: values.file,
    decoder: values.decoder,
    beamWidth: values["beam-width"],
    format: values.format,
    verbose: values.verbose ?? false,
    quiet: values.quiet ?? false,
  });
}

async function runIngestCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      files: { type: "string", short: "f" },
      db: { type: "string" },
      "dict-max": { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printIngestUsage();
    return;
  }

  const pattern = values.files;
  if (!pattern) {
    console.error("Error: --files / -f <glob> is required\n");
    printIngestUsage();
    process.exit(1);
  }

  const cwd = process.cwd();
  let config = await loadConfig({ cwd });
  config = applyDbOverride(config, values.db, cwd);

  let dictMax: number | undefined;
  if (values["dict-max"] !== undefined) {
    dictMax = Number(values["dict-max"]);
    if (!Number.isFinite(dictMax) || dictMax <= 0) {
      console.error("Error: --dict-max must be a positive number");
      process.exit(1);
    }
  }

  const ingestCwd = resolve(cwd, values.cwd ?? ".");

  await runIngest({
    config,
    pattern,
    cwd: ingestCwd,
    dictMax,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help"))) {
    printTokenizerUsage();
    return;
  }

  const match = parseSubcommand(argv);
  if (match === undefined) {
    if (argv.length > 0 && argv[0]?.startsWith("-")) {
      console.error("Error: options before the subcommand are not supported\n");
    } else {
      console.error("Error: expected subcommand: ingest or tokenize\n");
    }
    printTokenizerUsage();
    process.exit(1);
  }

  const commandArgs = match.rest;

  if (match.command === "ingest") {
    await runIngestCommand(commandArgs);
    return;
  }

  if (match.command === "tokenize") {
    try {
      await runTokenizeCommand(commandArgs);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      printDecodeUsage();
      process.exit(1);
    }
    return;
  }

  console.error(`Error: unknown command '${match.command}'\n`);
  printTokenizerUsage();
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
