# API reference

Public exports from `@khoralabs/tkn` and subpaths. Subpaths re-export the main API plus backend types.

## Package entry points

| Import | Additional exports |
|--------|-------------------|
| `@khoralabs/tkn` | Core API only |
| `@khoralabs/tkn/memory` | `Lattice`, `Graph`, `PatternVocabulary`, memory scorers |
| `@khoralabs/tkn/bun-sqlite` | `Lattice`, `Graph`, `Trie`, SQLite scorers |
| `@khoralabs/tkn/turso` | `TursoLattice`, `TursoGraph`, `TursoTrie`, `connectTurso` |

## Types

```typescript
type LatticeSegment = { key: string; sequence: string[] };

type SequencerInput = string | `<${number}>`;
type SequencerOutput = { sequence: SequencerInput[]; key: string };

type LatticeDecodeOptions =
  | { mode?: "viterbi" }
  | { mode: "beam"; beamWidth: number };
```

## `createLZSequencer(properties?)`

```typescript
interface LZSequencerProperties {
  cacheOptions?:
    | { bounded: true; max: number }
    | { bounded: false }
    | IDictionary;
  historyOptions?: { bounded: true; maxLength: number } | { bounded: false };
  emissionPolicy?: "immediate"; // accepted in type; not implemented
}
```

Returns `Sequencer<LZGate[]>`.

## `Sequencer`

| Member | Type | Description |
|--------|------|-------------|
| `push(input)` | `(SequencerInput) => void` | Process one input item |
| `flush()` | `() => Promise<void>` | Emit remaining buffer |
| `close()` | `() => Promise<void>` | Flush and close readers |
| `reset()` | `() => void` | Clear state |
| `snapshot()` | `() => Promise<ISequencerSnapshot[]>` | Gate snapshots |
| `read()` | `AsyncGenerator<SequencerOutput>` | Read queued segments |
| `drainPending()` | `() => SequencerOutput[]` | Move pending outputs to history |
| `history` | `SequencerOutput[]` | All emitted segments |
| `durationMS` | `number` | Time since first push |

## `createLatticeTokenizer(lattice, options?)`

Parameters: sync `ILattice`, optional `{ sequencer?, transitionBatchSize? }`.

Returns:

| Method | Returns | Description |
|--------|---------|-------------|
| `feed(text)` | `Promise<void>` | Run sequencer feed into lattice |
| `tokenize(text, options?)` | `string[]` | Decode text |
| `vocabulary()` | `string[]` | All pattern strings |
| `getTopTokens(limit?)` | `{ pattern, confidence }[]` | Top patterns by hub score |

## `createAsyncLatticeTokenizer(lattice, options?)`

Same as sync helper, but `tokenize`, `vocabulary`, and `getTopTokens` return promises.

## `ILattice`

| Method | Description |
|--------|-------------|
| `merge(pairs)` | Record transitions `[from, to, weight?][]` |
| `getNext(from)` | Outgoing transitions with weights |
| `nextCharacters(prefix)` | Trie child characters for prefix |
| `getTopTokens(limit?)` | Top patterns by hub score |
| `ingest(segment)` | Store one segment |
| `ingestBatch(segments)` | Store many segments |
| `commitFeedBatch(segments, pairs)` | Ingest and merge in one transaction |
| `tokenize(text, options?)` | Decode; compiles lazily |
| `compile()` | Build `ICompiledLattice` |
| `invalidateCompiled()` | Drop cached compile |
| `vocabulary()` | All pattern strings |
| `pipe(source, batchSize?)` | Ingest from async generator |
| `close()` | Close storage |

## `IAsyncLattice`

Same method set as `ILattice`. Storage methods return `Promise`.

## `ICompiledLattice`

| Member | Description |
|--------|-------------|
| `patternCount` | Vocabulary size in automaton |
| `scan(text)` | Match candidates per offset |
| `emissionLogProb(token)` | Unigram log-score |
| `transitionLogProb(from, to)` | Bigram log-score; `from` may be `null` |

## Compile and decode utilities

| Export | Description |
|--------|-------------|
| `buildLmTables(tokenCounts, edges)` | Build LM score functions |
| `compilePatterns(patterns, lm)` | Build `ICompiledLattice` from pattern list |
| `tokenizeCompiled(text, compiled, options?)` | Sync decode on compiled index |
| `tokenizeCompiledAsync(text, compiled, options?)` | Async decode on compiled index |
| `AhoCorasick` | Pattern automaton |
| `PatternVocabulary` | In-memory pattern store |

## Pipeline

| Export | Description |
|--------|-------------|
| `Pipeline` | Sync sequencer-to-lattice ingest |
| `AsyncPipeline` | Async sequencer-to-lattice ingest |
| `GlobFileJob` | File glob ingest job (character stream) |
| `feedInputStream` | Feed sync lattice from `AsyncGenerator<SequencerInput>` |
| `feedInputStreamAsync` | Feed async lattice from `AsyncGenerator<SequencerInput>` |

`IJob.input()` accepts any `AsyncGenerator<SequencerInput>`. Each yield is one token (string or sentinel), not necessarily one character.

## LZ sequencer

| Export | Description |
|--------|-------------|
| `LZGate` | Dictionary-membership gate |
| `Bounded` | Size-limited dictionary |
| `Unbounded` | Unbounded dictionary |
| `IDictionary` | Dictionary interface |

## Sequencer primitives

| Export | Description |
|--------|-------------|
| `Queue` | Output queue |
| `IGate` | Gate interface |
| `IGateSnapshot` | Gate snapshot type |

## Unicode

| Export | Description |
|--------|-------------|
| `Unicode.toCodepoints(text)` | String to codepoint array |
| `Unicode.toString(codepoints)` | Codepoint array to string |
| `Unicode.streamFile(file)` | NFC-normalized char stream from file |
| `Unicode.streamGlob(pattern, cwd?)` | Stream chars from glob-matched files |
| `toCodepoints`, `codepointsToString`, `streamUnicodeFile`, `streamGlob` | Standalone equivalents |

## Backend constructors

### Memory — `Lattice(config?)`

```typescript
interface MemoryLatticeConfig {
  scorer?: IMemoryHubScorer;
}
```

### Bun SQLite — `Lattice(config | filename?)`

```typescript
interface SqliteLatticeConfig {
  filename?: string;       // default ":memory:"
  scorer?: ISqliteHubScorer;
  bulkIngest?: boolean;
  readonly?: boolean;
}
```

### Turso — `TursoLattice.open(config | filename?)`

```typescript
interface TursoLatticeConfig {
  filename?: string;
  scorer?: ITursoHubScorer;
  bulkIngest?: boolean;
}
```

Returns `Promise<TursoLattice>`.

## Not exported

These types exist in source but are not part of the public API:

- `Resegmenter` / `IResegmenter`
