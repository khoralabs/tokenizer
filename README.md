# tkn

A fast, greedy pattern discovery algorithm for sequential data, based on LZ-style compression heuristics — with an optional lattice-backed decoder that turns discovered patterns into a learned tokenizer.

## What is tkn?

**tkn is not a traditional trained tokenizer.** It discovers patterns in sequential data through greedy segmentation. By tracking which patterns have been seen before (using an LZ-style inclusion heuristic), tkn naturally segments data at boundaries where patterns become novel.

The algorithm processes input one item at a time, growing sequences as long as they remain "known" and emitting them when they become "unknown." Over time, emission frequencies and co-occurrence patterns encode the structure of your data.

When you need to **segment new text** using what was learned, tkn provides a **lattice**: a graph of token transitions plus a vocabulary of patterns. Decoding uses a unigram + bigram language model with Viterbi (or beam) search — not longest-prefix matching.

## Goals

- **Fast pattern discovery**: Greedy, single-pass algorithm with minimal overhead
- **No training required**: Discovers patterns online as data arrives
- **Flexible**: Works with any sequential data (text, events, tokens, etc.)
- **Composable**: Gate-based architecture allows custom heuristics
- **Learned tokenization**: Optional lattice stores patterns and transitions for MDL-style decoding

## When to use tkn

✅ **Good for:**

- Discovering repetitive patterns in sequential data
- Building adaptive segmentation systems
- Analyzing data structure through emission frequencies
- Online/streaming pattern discovery
- Building tokenizers or compression schemes from observed structure

❌ **Not for:**

- Optimal segmentation (tkn is greedy, not optimal)
- Direct replacement for large-scale pretrained tokenizers (BPE, SentencePiece, etc.)
- Fixed vocabulary requirements without ingestion

## Installation

```bash
bun add @khoralabs/tkn
```

Package entry points:

| Import | Use |
|--------|-----|
| `@khoralabs/tkn` | Sequencer, pipeline, lattice interfaces, decode utilities |
| `@khoralabs/tkn/memory` | In-memory lattice (no persistence) |
| `@khoralabs/tkn/bun-sqlite` | Bun SQLite lattice |
| `@khoralabs/tkn/turso` | Turso/libSQL lattice (async) |

## Quick Start

### Pattern discovery (sequencer only)

```typescript
import { createLZSequencer } from "@khoralabs/tkn";

const sequencer = createLZSequencer();

const text = "hello world hello world";
for (const char of text) {
  sequencer.push(char);
}
sequencer.flush();

for await (const { sequence, key } of sequencer.read()) {
  console.log("Pattern:", sequence, "Key:", key);
}
```

### Lattice tokenization (discover + decode)

```typescript
import { createLatticeTokenizer, Lattice } from "@khoralabs/tkn/memory";

const lattice = new Lattice();
const tokenizer = createLatticeTokenizer(lattice);

await tokenizer.feed("hello world ".repeat(100));

console.log(tokenizer.tokenize("hello")); // e.g. ["he", "llo"] — Viterbi over learned LM
console.log(tokenizer.vocabulary());
console.log(tokenizer.getTopTokens(5));
```

### CLI

Ingest a corpus into a persisted lattice, then decode new text:

```bash
# Ingest files (SQLite by default → .tkn/lattice.db)
bun run tokenizer ingest -f "corpus/**/*.txt"

# Decode text against the trained lattice
bun run tokenize --text "hello world"
bun run tokenize -f input.txt --decoder beam --beam-width 32
```

Use `--backend turso` on both commands for the Turso backend.

## Architecture

```
┌─────────────┐     segments      ┌──────────────────────────────────┐
│ LZ Sequencer│ ────────────────► │ Lattice (persisted)              │
│ + Pipeline  │   key + sequence  │  • Graph: transitions + counts   │
└─────────────┘                   │  • Trie/PatternVocab: vocabulary │
                                  └──────────────┬───────────────────┘
                                                 │ compile()
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ ICompiledLattice (in-process)    │
                                  │  • Aho-Corasick pattern scan     │
                                  │  • Precomputed LM log-probs      │
                                  └──────────────┬───────────────────┘
                                                 │ tokenize()
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ Viterbi / beam decode            │
                                  └──────────────────────────────────┘
```

**Ingest** writes to durable storage (or in-memory maps). **Compile** builds a fast decode index from that state. **Tokenize** scans text once with Aho-Corasick, then runs bigram Viterbi over precomputed scores.

Each backend owns its own `compile()` logic; decoding always works against the abstract `ICompiledLattice`.

## Lattice tokenization

### Backends

All backends implement `ILattice` (sync) or `IAsyncLattice` (Turso) with the same surface area:

```typescript
import { Lattice as MemoryLattice } from "@khoralabs/tkn/memory";
import { Lattice as SqliteLattice } from "@khoralabs/tkn/bun-sqlite";
import { Lattice as TursoLattice } from "@khoralabs/tkn/turso";

const memory = new MemoryLattice();
const sqlite = new SqliteLattice({ filename: ".tkn/lattice.db" });
const turso = await TursoLattice.open({ filename: ".tkn/lattice.db" });
```

| Backend | Persistence | `compile()` | Best for |
|---------|-------------|-------------|----------|
| Memory | None | Sync | Tests, small corpora |
| Bun SQLite | File or `:memory:` | Sync | Local ingest/decode, CLI default |
| Turso | File or `:memory:` | Async | Non-blocking I/O, same API shape |

### Ingest

Segments from the LZ sequencer are written as lattice entries:

```typescript
type LatticeSegment = { key: string; sequence: string[] };

lattice.ingest({ key: "hello", sequence: ["h", "e", "l", "l", "o"] });
lattice.merge([["hello", "world"]]); // record transition
```

`createLatticeTokenizer` / `createAsyncLatticeTokenizer` wire the sequencer feed into ingest + merge automatically. For bulk file ingest, use `Pipeline` or `AsyncPipeline` with a `GlobFileJob`.

### Compile and decode

After ingest, call `compile()` to build an `ICompiledLattice`, or let `tokenize()` compile lazily on first use:

```typescript
const compiled = lattice.compile();
compiled.patternCount;
compiled.scan("hello");                    // MatchCandidate[][] by offset
compiled.emissionLogProb("he");            // Unigram log-prob
compiled.transitionLogProb("he", "llo");   // Bigram log-prob

lattice.tokenize("hello");        // Uses cached compile internally
lattice.invalidateCompiled();     // Drop cache after further ingest/merge
```

Decoding uses **add-k smoothed unigram emissions** and **normalized bigram transitions** (SentencePiece-style), scored with Viterbi by default:

```typescript
lattice.tokenize(longText, { mode: "beam", beamWidth: 32 });
```

You can also decode directly against a compiled lattice without a backend:

```typescript
import { compilePatterns, buildLmTables, tokenizeCompiled } from "@khoralabs/tkn";

const lm = buildLmTables(tokenCounts, edges);
const compiled = compilePatterns(patterns, lm);
tokenizeCompiled("hello", compiled);
```

### Tokenizer helpers

```typescript
import { createLatticeTokenizer, createAsyncLatticeTokenizer } from "@khoralabs/tkn";
import { Lattice as SqliteLattice } from "@khoralabs/tkn/bun-sqlite";
import { Lattice as TursoLattice } from "@khoralabs/tkn/turso";

const sync = createLatticeTokenizer(new SqliteLattice());
await sync.feed(corpus);
sync.tokenize("hello");

const async = createAsyncLatticeTokenizer(await TursoLattice.open());
await async.feed(corpus);
await async.tokenize("hello");
```

## API Reference

### `createLZSequencer(properties?)`

Factory function to create a pre-configured LZ-style sequencer.

**Parameters:**

```typescript
{
  cacheOptions?: { bounded: true; max: number } | { bounded: false };
  historyOptions?: { bounded: true; maxLength: number } | { bounded: false };
  emissionPolicy?: "immediate";
}
```

**Returns:** `Sequencer<LZGate[]>`

### `Sequencer`

The core pattern discovery engine.

**Methods:**

- `push(input: string | Sentinel)` - Process a single input
- `flush()` - Emit the current buffer as a pattern
- `reset()` - Clear all internal state
- `read()` - AsyncGenerator that yields discovered patterns
- `snapshot()` - Get current state and statistics

**Properties:**

- `history` - Array of all emitted patterns
- `durationMS` - Time since first input

### `LZGate`

Implements the LZ-style inclusion heuristic.

**Constructor:**

```typescript
new LZGate({
  name?: string;
  cache: IDictionary;  // Bounded or Unbounded
  stats?: boolean;
});
```

**Interface:**

- `evaluate(current: Key, previous: Key): boolean` - Returns true if pattern should continue growing
- `reset()` - Clear gate state
- `snapshot()` - Get gate statistics and cache utilization

### `Queue`

Manages the output queue and coordinates resegmentation.

**Constructor:**

```typescript
new Queue({
  resegmenters?: IResegmenter[];
  historyOptions?: { bounded: true; maxLength: number } | { bounded: false };
});
```

**Methods:**

- `push(output: SequencerOutput)` - Add an emitted pattern to the queue
- `read()` - AsyncGenerator that yields queued patterns
- `history` - Array of all consumed patterns

### `Resegmenter`

Abstract base class for implementing resegmentation logic.

**Abstract Methods:**

```typescript
abstract class Resegmenter {
  protected abstract transform(segments: SequencerOutput[]): SequencerOutput[];
  protected abstract shouldEmit(segments: SequencerOutput[]): boolean;
}
```

- `transform()` - Reorganize or modify the segments
- `shouldEmit()` - Return true to emit the queue without resegmentation (when all resegmenters return true, the queue flushes)

### `Pipeline` / `AsyncPipeline`

Connect a sequencer to a lattice for streaming ingest. `Pipeline` takes a sync `ILattice`; `AsyncPipeline` takes `IAsyncLattice`.

```typescript
import { Pipeline } from "@khoralabs/tkn";
import { GlobFileJob } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";

const lattice = new Lattice({ filename: ".tkn/lattice.db", bulkIngest: true });
const pipeline = new Pipeline({ lattice, sequencer, dictionary });
await pipeline.run(new GlobFileJob({ pattern: "corpus/**/*.txt" }));
```

### `ILattice` / `IAsyncLattice`

Core lattice interface. Key methods:

- `ingest(segment)` / `ingestBatch(segments)` — store patterns and emission counts
- `merge(pairs)` — record weighted transitions between pattern keys
- `compile()` — build `ICompiledLattice` from persisted state
- `invalidateCompiled()` — drop cached compile after mutations
- `tokenize(text, options?)` — decode with Viterbi or beam
- `vocabulary()` — all graph pattern strings
- `getTopTokens(limit?)` — top patterns by hub score

### `ICompiledLattice`

Backend-agnostic decode index produced by `compile()`:

- `scan(text)` — Aho-Corasick match candidates per offset
- `emissionLogProb(token)` — precomputed unigram score
- `transitionLogProb(from, to)` — precomputed bigram score
- `patternCount` — vocabulary size in the automaton

### `Unicode`

Utilities for Unicode-aware text processing.

**Static Methods:**

- `toCodepoints(text: string): number[]` - Convert text to codepoint array
- `toString(codepoints: number[]): string` - Convert codepoints back to text
- `streamFile(file: BunFile)` - Async generator for streaming file contents character-by-character (NFC normalized)

## Core Concepts

### Pattern Discovery

The algorithm maintains a "dictionary" of seen patterns and a "buffer" of the current sequence:

```
for each input:
  extended ← pattern + input

  if dictionary contains extended:
    // Known pattern - keep growing
    pattern ← extended
    add input to buffer
  else:
    // Unknown pattern - emit and reset
    emit buffer as discovered sequence
    dictionary learns extended
    buffer ← [input]
```

### Gates

Gates implement heuristics for deciding when to segment. The `LZGate` uses dictionary membership (have we seen this pattern before?) as its heuristic. You can implement custom gates by implementing the `IGate` interface.

### Sentinels

Special markers in the format `<number>` that can be used to inject boundaries or metadata into the sequence without being treated as regular input.

### Resegmenters

Resegmenters allow you to refine or reorganize the emitted patterns after initial segmentation. Each time a new pattern is emitted, resegmenters can examine the current queue and transform it based on custom logic.

**Use cases:**

- Merge adjacent patterns that meet certain criteria
- Split patterns based on higher-level rules
- Filter or reorder segments
- Apply post-processing transformations

A resegmenter runs on every emission until its `shouldEmit` condition is met. When all resegmenters signal they're ready to emit, the queue flushes its contents.

**Example resegmenter:**

```typescript
class MergeShortPatterns extends Resegmenter {
  protected shouldEmit(segments: SequencerOutput[]): boolean {
    // Emit when we don't have enough segments to merge
    return segments.length < 2;
  }

  protected transform(segments: SequencerOutput[]): SequencerOutput[] {
    const merged: SequencerOutput[] = [];
    let buffer: SequencerOutput | null = null;

    for (const segment of segments) {
      if (segment.sequence.length < 3) {
        // Accumulate short patterns
        if (!buffer) {
          buffer = segment;
        } else {
          buffer = {
            sequence: [...buffer.sequence, ...segment.sequence],
            key: buffer.key + segment.key,
          };
        }
      } else {
        // Flush accumulated patterns before long one
        if (buffer) {
          merged.push(buffer);
          buffer = null;
        }
        merged.push(segment);
      }
    }

    if (buffer) merged.push(buffer);
    return merged;
  }
}

// Use with a Queue
const queue = new Queue({
  resegmenters: [new MergeShortPatterns()],
});
```

Multiple resegmenters can be chained, with each operating on the output of the previous one.

## Advanced Usage

### Custom Gates

```typescript
import { Sequencer, Queue, type IGate } from "@khoralabs/tkn";

class MyCustomGate implements IGate {
  evaluate(current: string, previous: string): boolean {
    // Return true to continue growing, false to segment
    return myCustomLogic(current, previous);
  }

  reset() {
    // Clear any internal state
  }

  async snapshot() {
    return {
      name: "MyCustomGate",
      ingested: this.inputCount,
      passRate: this.passRate,
    };
  }
}

const sequencer = new Sequencer({
  gates: [new MyCustomGate()],
  queue: new Queue({}),
});
```

### Using Resegmenters

Resegmenters operate on the queue level, transforming patterns after emission:

```typescript
import {
  Sequencer,
  Queue,
  Resegmenter,
  LZGate,
  Unbounded,
} from "@khoralabs/tkn";

class MergeAdjacentDuplicates extends Resegmenter {
  protected shouldEmit(segments: SequencerOutput[]): boolean {
    // Emit when there's nothing to merge
    return segments.length < 2;
  }

  protected transform(segments: SequencerOutput[]): SequencerOutput[] {
    const result: SequencerOutput[] = [];
    let prev: SequencerOutput | null = null;

    for (const segment of segments) {
      if (prev && prev.key === segment.key) {
        // Merge with previous
        prev = {
          sequence: [...prev.sequence, ...segment.sequence],
          key: prev.key,
        };
      } else {
        if (prev) result.push(prev);
        prev = segment;
      }
    }
    if (prev) result.push(prev);
    return result;
  }
}

const sequencer = new Sequencer({
  gates: [new LZGate({ cache: new Unbounded() })],
  queue: new Queue({
    resegmenters: [new MergeAdjacentDuplicates()],
  }),
});
```

### Bounded Dictionary

For memory-constrained environments:

```typescript
const sequencer = createLZSequencer({
  cacheOptions: { bounded: true, max: 10000 },
  historyOptions: { bounded: true, maxLength: 1000 },
});
```

## CLI reference

### `tokenizer ingest`

Train a lattice from files on disk.

```bash
bun run tokenizer ingest -f "corpus/**/*.txt" [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-f, --files` | (required) | Glob of files to ingest |
| `--db` | `.tkn/lattice.db` | Output database path |
| `--backend` | `sqlite` | `sqlite` or `turso` |
| `--dict-max` | `10000` | Bounded LZ dictionary capacity |
| `--cwd` | project root | Directory for glob resolution |

### `tokenize`

Decode text using a trained lattice.

```bash
bun run tokenize [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-t, --text` | — | Text to tokenize |
| `-f, --file` | — | Read text from file (or pipe via stdin) |
| `--db` | `.tkn/lattice.db` | Lattice database path |
| `--backend` | `sqlite` | `sqlite` or `turso` |
| `--decoder` | `viterbi` | `viterbi` or `beam` |
| `--beam-width` | `32` | Beam width when `--decoder beam` |
| `--format` | `json` | `json` or `lines` |
| `-v, --verbose` | off | Print stats to stderr |

## License

MIT
