# CLI reference

Two binaries: `tkn` (ingest, tokenize, topk) and `tokenize` (decode).

Configuration comes from `tkn.config.json` in the caller working directory, or from the path in `TKN_CONFIG`. Simple flags can override individual settings.

## Configuration

Default file: `tkn.config.json` (cwd-relative).

Environment override: `TKN_CONFIG=/path/to/config.json`

Example:

```json
{
  "lattice": {
    "backend": "sqlite",
    "path": ".tkn/lattice.db"
  },
  "ingest": { "dictMax": 10000 },
  "decode": { "decoder": "viterbi", "beamWidth": 32 },
  "output": { "topK": 5 }
}
```

| Section | Fields | Notes |
|---------|--------|-------|
| `lattice.backend` | `sqlite` or `turso` | Not available as a CLI flag |
| `lattice.path` | string | Database file or Turso URL; override with `--db` |
| `ingest.dictMax` | number | LZ dictionary capacity; override with `--dict-max` |
| `decode.decoder` | `viterbi` or `beam` | Override with `--decoder` |
| `decode.beamWidth` | number | Override with `--beam-width` |
| `output.topK` | number (max 100) | Default top-k for ingest summary and `tkn topk` |

See [tkn.config.example.json](../../tkn.config.example.json) in the repository root.

Path flags (`--db`, `--cwd`, `--file`) resolve relative to the **caller working directory**, not the package install location.

## `tkn`

Entry: `scripts/tkn.ts`  
Bin name: `tkn`

### Subcommands

| Subcommand | Action |
|------------|--------|
| `ingest` | Ingest files into a lattice database |
| `tokenize` | Decode text (same flags as `tokenize` bin) |
| `topk` | Print vocabulary size and top hub-scored patterns |

Global flags:

- `-h`, `--help` — show usage (exit 0)
- `--version` — print package version

### `tkn ingest`

```bash
tkn ingest -f <glob> [options]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--files` | `-f` | (required) | Glob of files to ingest |
| `--db` | | from config | Override `lattice.path` |
| `--dict-max` | | from config | Override `ingest.dictMax` |
| `--cwd` | | `.` | Directory for glob resolution (cwd-relative) |
| `--help` | `-h` | | Show usage |

Exit code `1` when zero segments are emitted.

### `tkn tokenize`

Same options as the `tokenize` binary. See below.

### `tkn topk`

```bash
tkn topk [options]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--db` | | from config | Override `lattice.path` |
| `--limit` | `-n` | from `output.topK` | Max patterns to print (capped at 100) |
| `--format` | | `human` | `human` or `json` |
| `--help` | `-h` | | Show usage |

Human output:

```
1234 patterns
"hello": 0.8421
```

JSON output includes only the top K patterns, never the full vocabulary.

## `tokenize`

Entry: `scripts/tokenize.ts`  
Bin name: `tokenize`

Decode text using a trained lattice. No subcommands — flags only.

```bash
tokenize [options]
```

Global:

- `--version` — print package version

### Input (one required)

| Flag | Short | Description |
|------|-------|-------------|
| `--text` | `-t` | Text to decode |
| `--file` | `-f` | Read text from file (cwd-relative) |
| stdin pipe | | Used when stdin is not a TTY |

### Lattice

| Flag | Default | Description |
|------|---------|-------------|
| `--db` | from config | Override `lattice.path` |

### Decoder

| Flag | Default | Description |
|------|---------|-------------|
| `--decoder` | from config | `viterbi` or `beam` |
| `--beam-width` | from config | Beam width when `--decoder beam` |

### Output

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--format` | | `json` | `json` (array on stdout) or `lines` (one token per line) |
| `--quiet` | `-q` | on unless `--verbose` | Suppress informational stderr |
| `--verbose` | `-v` | off | Print lattice stats to stderr |
| `--help` | `-h` | | Show usage |

Errors:

- Database file not found
- Lattice has zero patterns (run ingest first)
