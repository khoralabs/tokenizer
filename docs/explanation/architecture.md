# Architecture

Component layout and data flow from ingest to token output.

## Pipeline overview

```
┌─────────────┐     segments      ┌──────────────────────────────────┐
│ LZ Sequencer│ ────────────────► │ Lattice (persisted or in-memory) │
│ + Pipeline  │   key + sequence  │  • Graph: transitions + counts   │
└─────────────┘                   │  • Vocab: pattern strings          │
                                  └──────────────┬───────────────────┘
                                                 │ compile()
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ ICompiledLattice                   │
                                  │  • Aho-Corasick pattern scan       │
                                  │  • Precomputed LM log-probs        │
                                  └──────────────┬───────────────────┘
                                                 │ tokenize()
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ Viterbi or beam decode             │
                                  └──────────────────────────────────┘
```

## Components

### Sequencer

The sequencer accepts sequential input one item at a time. Gates decide whether the current prefix continues or segments. Emitted segments go to a queue. Consumers read segments through `read()`.

`createLZSequencer` builds a sequencer with one `LZGate` and a default queue.

### Pipeline

`Pipeline` connects a sequencer to a sync `ILattice`. `AsyncPipeline` connects to an `IAsyncLattice`. Jobs such as `GlobFileJob` supply input streams from files on disk.

### Lattice

The lattice stores:

- **Graph** — pattern keys as nodes, weighted transitions as edges
- **Vocabulary** — pattern strings linked to graph nodes

Ingest writes `LatticeSegment` values `{ key, sequence }`. Merge records transitions between consecutive pattern keys.

### Compiled index

`compile()` reads persisted or in-memory state and builds `ICompiledLattice`:

- An Aho-Corasick automaton over vocabulary patterns
- Precomputed unigram emission log-probabilities
- Precomputed bigram transition log-probabilities

Each backend implements its own `compile()` logic. Decoding always uses the abstract `ICompiledLattice` interface.

### Decoder

`tokenize()` scans input once, collects match candidates per offset, and runs Viterbi or beam search over LM scores. Default mode is Viterbi.

## Backend storage

| Backend | Vocabulary storage | Graph storage | I/O |
|---------|-------------------|---------------|-----|
| Memory | `PatternVocabulary` (Aho-Corasick) | In-memory maps | Sync |
| Bun SQLite | `Trie` in SQLite | Graph tables in SQLite | Sync |
| Turso | `Trie` in libSQL | Graph tables in libSQL | Async |

Subpath imports add backend types but re-export the full main API.

## Sync and async interfaces

`ILattice` methods are synchronous. `IAsyncLattice` methods return promises for storage operations. Turso implements `IAsyncLattice`. Memory and Bun SQLite implement `ILattice`.

Tokenizer helpers mirror the backend:

- `createLatticeTokenizer` — sync lattice
- `createAsyncLatticeTokenizer` — async lattice

## Cache invalidation

Ingest and merge invalidate the cached compiled index. Call `invalidateCompiled()` explicitly after mutations, or rely on `tokenize()` to recompile when the cache is empty.
