# Architecture

Component layout and data flow from ingest to token output.

## Pipeline overview

```
┌─────────────┐     segments      ┌──────────────────────────────────┐
│ Atom feed   │                   │                                  │
│ → Sequencer │ ────────────────► │ Lattice (persisted or in-memory) │
│ + Pipeline  │   key + sequence  │  • Graph: transitions + counts   │
└─────────────┘                   │  • Vocab / trie: atom edges      │
                                  └──────────────┬───────────────────┘
                                                 │ compile()
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ ICompiledLattice                   │
                                  │  • Aho-Corasick over atoms         │
                                  │  • patterns, scan / scanAtoms      │
                                  │  • Precomputed LM log-probs        │
                                  └──────────────┬───────────────────┘
                                                 │ tokenize / decodeIndexed
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ Viterbi or beam decode             │
                                  └──────────────────────────────────┘
```

## Components

### Atom feeds

`feedCharacters`, `feedBytes`, and `feedSymbols` produce `AsyncGenerator<SequencerInput>`. The feed chooses the lattice matcher alphabet. Pass feeds to `feedInputStream` / `feedInputStreamAsync` or wrap them in an `IJob` for `Pipeline`.

### Sequencer

The sequencer accepts sequential input one atom at a time. Gates decide whether the current prefix continues or segments. Optional `atomDelimiter` joins multi-atom pattern keys. Emitted segments go to a queue. Consumers read segments through `read()`.

`createLZSequencer` builds a sequencer with one `LZGate` and a default queue.

### Pipeline

`Pipeline` connects a sequencer to a sync `ILattice`. `AsyncPipeline` connects to an `IAsyncLattice`. Jobs such as `GlobFileJob` supply input streams from files on disk.

### Lattice

The lattice stores:

- **Graph** — pattern keys as nodes, weighted transitions as edges
- **Vocabulary / trie** — pattern strings with one edge per feed atom

Ingest writes `LatticeSegment` values `{ key, sequence }`. Merge records transitions between consecutive pattern keys. Trie merge follows `sequence`, not UTF-16 splits of `key`.

### Compiled index

`compile(options?)` reads persisted or in-memory state and builds `ICompiledLattice`:

- An Aho-Corasick automaton over vocabulary atom paths
- `patterns` — terminal pattern keys from compile
- `scan(text)` / `scanAtoms(source)` — match candidates per offset
- Precomputed unigram emission and bigram transition log-probabilities

Default LM smoothing is cached. Non-default `LmCompileOptions.smoothing` returns an uncached snapshot. Each backend implements its own `compile()` logic. Decoding always uses the abstract `ICompiledLattice` interface.

### Decoder

`tokenizeAtoms` / `tokenizeCompiledAtoms` decode over an explicit atom source. `tokenize` / `decode` / `scan` are character-grain adapters onto the same indexed core. `decodeIndexed` remains available for custom candidate logic. Default mode is Viterbi. Incomplete coverage returns `[]` from tokenize helpers (`complete: false` from detailed/indexed APIs).

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
