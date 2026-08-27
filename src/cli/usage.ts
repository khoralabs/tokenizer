import { DEFAULT_CONFIG } from "./config.ts";

export function printTknUsage(): void {
  console.log(`Usage: tkn <command> [options]

Commands:
  ingest    Ingest files into a lattice database
  tokenize  Decode text using a trained lattice (see: tokenize --help)
  topk      Print vocabulary size and top hub-scored patterns

Global:
  -h, --help     Show this help
  --version      Show package version

Run 'tkn <command> --help' for command-specific options.
Backend settings come from tkn.config.json or TKN_CONFIG.
`);
}

export function printIngestUsage(): void {
  console.log(`Usage: tkn ingest -f <glob> [options]

  -f, --files <glob>     Glob pattern of files to ingest (required)
  --db <path>            Override lattice.path from config (default: ${DEFAULT_CONFIG.lattice.path})
  --dict-max <n>         Override ingest.dictMax (default: ${DEFAULT_CONFIG.ingest.dictMax})
  --cwd <path>           Directory for glob resolution (default: current working directory)
  -h, --help             Show this help

Backend and other settings come from tkn.config.json or TKN_CONFIG.
`);
}

export function printDecodeUsage(): void {
  console.log(`Usage: tokenize [options]

Decode input text using a trained lattice.

Input (one required):
  -t, --text <string>    Text to tokenize
  -f, --file <path>      Read text from a file
                         (or pipe text via stdin)

Lattice:
  --db <path>            Override lattice.path from config (default: ${DEFAULT_CONFIG.lattice.path})

Decoder:
  --decoder <name>       Override decode.decoder (default: ${DEFAULT_CONFIG.decode.decoder})
  --beam-width <n>       Beam width when --decoder beam (default: ${DEFAULT_CONFIG.decode.beamWidth})

Output:
  --format <name>        json or lines (default: json)
  -q, --quiet            Suppress informational stderr (default unless --verbose)
  -v, --verbose          Print lattice stats to stderr
  -h, --help             Show this help

Backend comes from tkn.config.json or TKN_CONFIG.
`);
}

export function printTopkUsage(): void {
  console.log(`Usage: tkn topk [options]

  --db <path>            Override lattice.path from config (default: ${DEFAULT_CONFIG.lattice.path})
  -n, --limit <n>        Number of patterns to show (default: ${DEFAULT_CONFIG.output.topK}, max 100)
  --format <name>        human or json (default: human)
  -h, --help             Show this help

Backend comes from tkn.config.json or TKN_CONFIG.
`);
}
