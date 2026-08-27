# @khoralabs/tkn _(tkn)_

Online pattern discovery and lattice-backed decoding for sequential text.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [CLI](#cli)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Background

The npm package is `@khoralabs/tkn`.

tkn discovers segments in sequential input through a LZ-style dictionary gate. The gate grows a prefix while the extended pattern is in the dictionary. The gate emits a segment when the extended pattern is not in the dictionary.

An optional lattice stores discovered patterns and transitions between them. Decoding runs Aho-Corasick pattern matching and Viterbi or beam search over add-k smoothed unigram and normalized bigram scores.

Segmentation is greedy and single-pass. The library does not implement BPE or SentencePiece.

See [Architecture](docs/explanation/architecture.md) and [Algorithm](docs/explanation/algorithm.md) for component and behavior detail.

## Install

```bash
bun add @khoralabs/tkn
```

| Import | Use |
|--------|-----|
| `@khoralabs/tkn` | Core API |
| `@khoralabs/tkn/memory` | Core API plus in-memory lattice |
| `@khoralabs/tkn/bun-sqlite` | Core API plus Bun SQLite lattice |
| `@khoralabs/tkn/turso` | Core API plus Turso/libSQL lattice |

Each subpath re-exports the full main API and adds a backend-specific `Lattice` class.

## Releasing

Publish via GitHub Actions (`workflow_dispatch` on [`.github/workflows/release.yml`](./.github/workflows/release.yml)): choose semver + npm dist-tag. Staging script: `bun run stage-release -- <version>`.

## Usage

```typescript
import { createLatticeTokenizer } from "@khoralabs/tkn/memory";
import { Lattice } from "@khoralabs/tkn/memory";

const lattice = new Lattice();
const tokenizer = createLatticeTokenizer(lattice);

await tokenizer.feed("hello world ".repeat(100));
console.log(tokenizer.tokenize("hello"));
console.log(tokenizer.vocabulary());
```

See [Getting started](docs/tutorials/getting-started.md) for a full walkthrough.

## CLI

Configure lattice backend and defaults in `tkn.config.json` (or set `TKN_CONFIG`). Copy [tkn.config.example.json](./tkn.config.example.json) as a starting point.

| Command | Action |
|---------|--------|
| `tkn ingest` | Ingest files into a lattice database |
| `tkn tokenize` | Decode text (same as `tokenize` bin) |
| `tkn topk` | Print vocabulary size and top hub-scored patterns |
| `tokenize` | Decode text against a trained lattice database |

See [CLI reference](docs/reference/cli.md) for configuration, flags, and examples.

## Documentation

| Section | Path |
|---------|------|
| Tutorials | [docs/tutorials/](docs/tutorials/) — [getting started](docs/tutorials/getting-started.md), [custom symbol streams](docs/tutorials/custom-symbol-streams.md), [log traces](docs/tutorials/log-traces-and-symbol-registries.md) |
| How-to | [docs/how-to/](docs/how-to/) |
| Explanation | [docs/explanation/](docs/explanation/) |
| Reference | [docs/reference/](docs/reference/) |

Index: [docs/README.md](docs/README.md)

## Contributing

Run these checks before opening a pull request:

```bash
bun run format:check
bun run typecheck
bun test
```

Open issues and pull requests at [github.com/khoralabs/tokenizer](https://github.com/khoralabs/tokenizer).

## License

[MIT](LICENSE) © Khora Labs
