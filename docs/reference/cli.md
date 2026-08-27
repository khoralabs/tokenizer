# CLI reference

Two binaries: `tokenizer` (ingest) and `tokenize` (decode).

## `tokenizer`

Entry: `scripts/tokenizer.ts`  
Bin name: `tokenizer`

### Subcommands

| Subcommand | Status |
|------------|--------|
| `ingest` | Implemented |
| `tokenize` | Not implemented — use the `tokenize` binary |

The help text references `tokenizer tokenize`. That subcommand exits with usage output.

### `tokenizer ingest`

Ingest files into a lattice database.

```bash
bun run tokenizer ingest -f <glob> [options]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--files` | `-f` | (required) | Glob of files to ingest |
| `--db` | | `.tkn/lattice.db` | Database path (relative to project root) |
| `--backend` | | `sqlite` | `sqlite` or `turso` |
| `--dict-max` | | `10000` | Bounded LZ dictionary capacity |
| `--cwd` | | project root | Directory for glob resolution |
| `--help` | `-h` | | Show usage |

Exit code `1` when zero segments are emitted.

## `tokenize`

Entry: `scripts/tokenize.ts`  
Bin name: `tokenize`

Decode text using a trained lattice.

```bash
bun run tokenize [options]
```

### Input (one required)

| Flag | Short | Description |
|------|-------|-------------|
| `--text` | `-t` | Text to decode |
| `--file` | `-f` | Read text from file |
| stdin pipe | | Used when stdin is not a TTY |

### Lattice

| Flag | Default | Description |
|------|---------|-------------|
| `--db` | `.tkn/lattice.db` | Database path |
| `--backend` | `sqlite` | `sqlite` or `turso` |

### Decoder

| Flag | Default | Description |
|------|---------|-------------|
| `--decoder` | `viterbi` | `viterbi` or `beam` |
| `--beam-width` | `32` | Beam width when `--decoder beam` |

### Output

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--format` | | `json` | `json` (array on stdout) or `lines` (one token per line) |
| `--verbose` | `-v` | off | Print stats to stderr |
| `--help` | `-h` | | Show usage |

Database path and pattern count print to stderr on every run.

Errors:

- Database file not found
- Lattice has zero patterns (run ingest first)
