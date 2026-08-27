# Ingest a corpus

Ingest writes LZ sequencer segments and transition pairs into a lattice database.

## Prerequisites

- A text corpus on disk
- Bun and `@khoralabs/tkn` installed

## CLI ingest

Create `tkn.config.json` in your working directory:

```json
{
  "lattice": { "backend": "sqlite", "path": ".tkn/lattice.db" },
  "ingest": { "dictMax": 10000 },
  "output": { "topK": 5 }
}
```

Run ingest:

```bash
bun run tkn ingest -f "corpus/**/*.txt"
```

Optional flag overrides:

```bash
bun run tkn ingest \
  -f "corpus/**/*.txt" \
  --db .tkn/lattice.db \
  --dict-max 10000 \
  --cwd .
```

Set `lattice.backend` to `turso` in config for the Turso backend. See [CLI reference](../reference/cli.md) for all options.

**Outcome:** stderr reports segment count, vocabulary size, and top patterns. The database file exists at the configured path (cwd-relative).

## Programmatic ingest (SQLite)

Import `Pipeline`, `GlobFileJob`, and the SQLite lattice. Build a sequencer with an `LZGate` and a bounded or unbounded dictionary. Run the pipeline on a glob job.

```typescript
import { GlobFileJob, Pipeline } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { Bounded } from "@khoralabs/tkn";
import { LZGate } from "@khoralabs/tkn";
import { Queue, Sequencer } from "@khoralabs/tkn";

const dictionary = new Bounded(10_000);
const sequencer = new Sequencer({
  gates: [new LZGate({ cache: dictionary })],
  queue: new Queue({ historyOptions: { bounded: false } }),
});

const lattice = new Lattice({ filename: ".tkn/lattice.db", bulkIngest: true });
const pipeline = new Pipeline({ lattice, sequencer, dictionary });

await pipeline.run(new GlobFileJob({ pattern: "corpus/**/*.txt", cwd: "." }));

console.log(lattice.vocabulary().length);
lattice.close();
```

## Programmatic ingest (Turso)

Use `AsyncPipeline` with `TursoLattice.open()` and the same job shape.

```typescript
import { AsyncPipeline, GlobFileJob } from "@khoralabs/tkn";
import { TursoLattice } from "@khoralabs/tkn/turso";
import { Bounded, LZGate, Queue, Sequencer } from "@khoralabs/tkn";

const dictionary = new Bounded(10_000);
const sequencer = new Sequencer({
  gates: [new LZGate({ cache: dictionary })],
  queue: new Queue({ historyOptions: { bounded: false } }),
});

const lattice = await TursoLattice.open({ filename: ".tkn/lattice.db", bulkIngest: true });
const pipeline = new AsyncPipeline({ lattice, sequencer, dictionary });

await pipeline.run(new GlobFileJob({ pattern: "corpus/**/*.txt", cwd: "." }));

console.log((await lattice.vocabulary()).length);
await lattice.close();
```

## Tokenizer helper ingest

`createLatticeTokenizer` and `createAsyncLatticeTokenizer` wrap feed logic. Call `await feed(text)` on a string corpus instead of a file glob.

```typescript
import { createLatticeTokenizer, Lattice } from "@khoralabs/tkn/memory";

const tokenizer = createLatticeTokenizer(new Lattice());
await tokenizer.feed(corpusText);
```

**Outcome:** `tokenizer.vocabulary()` returns the ingested pattern strings.
