# Getting started

This tutorial walks through pattern discovery, in-memory lattice tokenization, and persisted ingest plus CLI decode.

## Prerequisites

- [Bun](https://bun.sh) installed
- `@khoralabs/tkn` added to your project

## Step 1 — Install

```bash
bun add @khoralabs/tkn
```

## Step 2 — Discover patterns with the sequencer

Import `createLZSequencer` from the main package. Push input one character at a time. Call `await flush()` when input ends.

```typescript
import { createLZSequencer } from "@khoralabs/tkn";

const sequencer = createLZSequencer();
const text = "hello world hello world";

for (const char of text) {
  sequencer.push(char);
}
await sequencer.flush();

for await (const { key, sequence } of sequencer.read()) {
  console.log(key, sequence.join(""));
}
```

The sequencer emits segments when the LZ gate reports an unknown extended prefix.

## Step 3 — Feed a corpus into a memory lattice

Import the memory backend. Create a lattice and a tokenizer helper. Feed text with `await feed()`. Tokenize with `tokenize()`.

```typescript
import { createLatticeTokenizer, Lattice } from "@khoralabs/tkn/memory";

const lattice = new Lattice();
const tokenizer = createLatticeTokenizer(lattice);

await tokenizer.feed("hello world ".repeat(100));

console.log(tokenizer.tokenize("hello"));
console.log(tokenizer.vocabulary().length);
console.log(tokenizer.getTopTokens(5));
```

`feed()` runs the LZ sequencer and writes segments and transitions into the lattice.

## Step 4 — Ingest files into a SQLite lattice

From the project root, run the ingest command on a text corpus.

```bash
bun run tokenizer ingest -f "corpus/**/*.txt"
```

The command writes `.tkn/lattice.db` by default. It prints segment count and vocabulary size.

## Step 5 — Decode text with the CLI

Run the decode command against the trained database.

```bash
bun run tokenize --text "hello world"
```

Stdout contains a JSON array of token strings.

## Next steps

- [Custom symbol streams](../tutorials/custom-symbol-streams.md) — discrete tokens, not character-by-character
- [Log traces and symbol registries](../tutorials/log-traces-and-symbol-registries.md) — host symbol mapping and pre-segmented ingest
- [Ingest a corpus](../how-to/ingest-a-corpus.md) — programmatic ingest with `Pipeline`
- [Decode text](../how-to/decode-text.md) — Viterbi, beam, and compile options
- [Use from TypeScript](../how-to/use-from-typescript.md) — backend and sync/async APIs
- [API reference](../reference/api.md)
