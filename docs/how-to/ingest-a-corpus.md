# Ingest a corpus

Ingest writes LZ sequencer segments and transition pairs into a lattice database.

## Prerequisites

- A text corpus on disk
- Bun and `@khoralabs/tkn` installed

## CLI ingest

Run ingest from the project root.

```bash
bun run tokenizer ingest -f "corpus/**/*.txt"
```

Optional flags:

```bash
bun run tokenizer ingest \
  -f "corpus/**/*.txt" \
  --db .tkn/lattice.db \
  --backend sqlite \
  --dict-max 10000 \
  --cwd .
```

Use `--backend turso` for the Turso backend. See [CLI reference](../reference/cli.md) for all flags.

**Outcome:** stderr reports segment count and vocabulary size. The database file exists at the `--db` path.

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
