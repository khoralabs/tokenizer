#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { applyDbOverride, loadConfig } from "../src/cli/config.ts";
import { runDecodeFromCli } from "../src/cli/run-decode.ts";
import { printDecodeUsage } from "../src/cli/usage.ts";
import { getPackageVersion } from "../src/cli/version.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--version")) {
    console.log(getPackageVersion());
    return;
  }

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

  try {
    await runDecodeFromCli(config, {
      text: values.text,
      file: values.file,
      decoder: values.decoder,
      beamWidth: values["beam-width"],
      format: values.format,
      verbose: values.verbose ?? false,
      quiet: values.quiet ?? !(values.verbose ?? false),
    });
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    printDecodeUsage();
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
