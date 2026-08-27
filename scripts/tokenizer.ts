#!/usr/bin/env bun

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyDbOverride, loadConfig } from "../src/cli/config.ts";
import { runIngest } from "../src/cli/run-ingest.ts";
import { printIngestUsage, printTokenizerUsage } from "../src/cli/usage.ts";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      files: { type: "string", short: "f" },
      db: { type: "string" },
      "dict-max": { type: "string" },
      cwd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help && positionals.length === 0) {
    printTokenizerUsage();
    return;
  }

  const [command] = positionals;
  if (command === undefined) {
    printTokenizerUsage();
    process.exit(1);
  }

  if (command === "ingest") {
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
    return;
  }

  console.error(`Error: unknown command '${command}'\n`);
  printTokenizerUsage();
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
