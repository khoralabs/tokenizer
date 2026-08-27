import { DEFAULT_CONFIG } from "./config.ts";

export function printTokenizerUsage(): void {
  console.log(`Usage: tokenizer ingest -f <glob> [options]

Commands:
  ingest    Ingest files into a lattice database

Global:
  -h, --help     Show this help

Run 'tokenizer ingest --help' for ingest options.

Decode with the tokenize binary. Backend settings come from tkn.config.json or TKN_CONFIG.
`);
}

export function printIngestUsage(): void {
  console.log(`Usage: tokenizer ingest -f <glob> [options]

  -f, --files <glob>     Glob pattern of files to ingest (required)
  --db <path>            Override lattice.path from config (default: ${DEFAULT_CONFIG.lattice.path})
  --dict-max <n>         Override ingest.dictMax (default: ${DEFAULT_CONFIG.ingest.dictMax})
  --cwd <path>           Directory for glob resolution (default: current working directory)
  -h, --help             Show this help

Backend and other settings come from tkn.config.json or TKN_CONFIG.
`);
}
