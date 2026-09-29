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
type Atom = string;

type TerminalEntry = { pattern: string; atoms: readonly Atom[] };

type LatticeSegment = { key: string; sequence: Atom[] };

/** Alias of `Atom` (includes sentinel-shaped strings like `<0>`). */
type SequencerInput = Atom;
type SequencerOutput = { sequence: Atom[]; key: string };

type MatchCandidate = { pattern: string; length: number };

type LatticeDecodeOptions =
  | { mode?: "viterbi"; useBigram?: boolean }
  | { mode: "beam"; beamWidth: number; useBigram?: boolean };

type LmCompileOptions = { smoothing?: number };

type DecodeStep = {
  token: string;
  start: number;
  end: number;
  emissionScore: number;
  transitionScore: number;
  cumulativeScore: number;
};

type DecodeResult = {
  tokens: string[];
  steps: DecodeStep[];
  score: number;
  complete: boolean;
};
```

`MatchCandidate.length` is a count of **source atoms**, not JavaScript string length.

## Atoms

| Export | Description |
|--------|-------------|
| `Atom` | Opaque stream unit (string) |
| `TerminalEntry` | Pattern key plus atom path used at insert |
| `atomsFromText(text)` | One atom per UTF-16 code unit |
| `joinAtoms(atoms, delimiter?)` | Join atoms into a pattern key |
| `splitAtoms(key, delimiter)` | Split a key; drops empty trailing segments |
| `assertNonEmptyAtoms(atoms)` | Throws if atoms empty or contain `""` |

## Atom feeds

Convenience generators that select the lattice matcher alphabet. Pass the result to `feedInputStream` / `feedInputStreamAsync`.

| Export | Input | Atoms |
|--------|-------|-------|
| `feedCharacters(text)` | `string` | UTF-16 code units |
| `feedBytes(bytes)` | `Uint8Array` | Latin-1 code units via `String.fromCharCode` |
| `feedSymbols(symbols)` | `readonly Atom[]` | Unchanged opaque strings (rejects `""`) |

Choosing a feed chooses the trie/AC edge alphabet for that lattice.

## `createLZSequencer(properties?)`

```typescript
interface LZSequencerProperties {
  cacheOptions?:
    | { bounded: true; max: number }
    | { bounded: false }
    | IDictionary;
  historyOptions?: { bounded: true; maxLength: number } | { bounded: false };
  emissionPolicy?: "immediate"; // accepted in type; not implemented
  atomDelimiter?: string; // default ""; inserted between atoms in pattern keys
}
```

Returns `Sequencer<LZGate[]>`.

## `Sequencer`

Constructor options include `atomDelimiter?: string` (default `""`). When non-empty, keys are composed as `previous + delimiter + input` after the first atom.

| Member | Type | Description |
|--------|------|-------------|
| `push(input)` | `(SequencerInput) => void` | Process one input item |
| `flush()` | `() => Promise<void>` | Emit remaining buffer and clear candidates; keep dictionary |
| `endSequence()` | `() => Promise<void>` | Sequence boundary: flush + clear candidates; keep dictionary |
| `close()` | `() => Promise<void>` | Flush and close readers |
| `reset()` | `() => void` | Discard candidates and clear gate dictionaries |
| `snapshot()` | `() => Promise<ISequencerSnapshot[]>` | Gate snapshots |
| `read()` | `AsyncGenerator<SequencerOutput>` | Read queued segments |
| `drainPending()` | `() => SequencerOutput[]` | Move pending outputs to history |
| `history` | `SequencerOutput[]` | All emitted segments |
| `durationMS` | `number` | Time since first push |

`Sequencer.evaluate(previous, input, gates, atomDelimiter?)` accepts an optional delimiter (default `""`).

## `createLatticeTokenizer(lattice, options?)`

Parameters: sync `ILattice`, optional `{ sequencer?, transitionBatchSize? }`.

Returns:

| Method | Returns | Description |
|--------|---------|-------------|
| `feed(text)` | `Promise<void>` | Character-atom feed into lattice via `feedCharacters` |
| `tokenize(text, options?)` | `string[]` | Decode text |
| `vocabulary()` | `string[]` | All pattern strings |
| `getTopTokens(limit?)` | `{ pattern, confidence }[]` | Top patterns by hub score |

## `createAsyncLatticeTokenizer(lattice, options?)`

Same as sync helper, but `tokenize`, `vocabulary`, and `getTopTokens` return promises. `feed` uses `feedCharacters`.

## `ILattice`

| Method | Description |
|--------|-------------|
| `merge(pairs)` | Record transitions `[from, to, weight?][]` |
| `getNext(from)` | Outgoing transitions with weights |
| `nextCharacters(prefix)` | Trie child atoms for a character-atom prefix string |
| `getTopTokens(limit?)` | Top patterns by hub score |
| `ingest(segment)` | Store one segment (trie edges follow `sequence` atoms) |
| `ingestBatch(segments)` | Store many segments |
| `commitFeedBatch(segments, pairs)` | Ingest and merge in one transaction |
| `tokenize(text, options?)` | Decode text; compiles lazily |
| `compile(options?)` | Build `ICompiledLattice`; optional `{ smoothing }` |
| `invalidateCompiled()` | Drop cached compile |
| `vocabulary()` | Graph pattern strings |
| `pipe(source, batchSize?)` | Ingest from async generator |
| `close()` | Close storage |

`compile({ smoothing })` with non-default smoothing returns an uncached snapshot. Default smoothing fills the decode cache.

## `IAsyncLattice`

Same method set as `ILattice`. Storage methods return `Promise`.

## `ICompiledLattice`

| Member | Description |
|--------|-------------|
| `patternCount` | Number of compiled patterns |
| `terminals` | Frozen `TerminalEntry[]` (pattern + atom path) |
| `patterns` | Pattern keys derived from `terminals` |
| `scan(text)` | Match candidates per UTF-16 offset |
| `scanAtoms(source)` | Match candidates per atom offset |
| `emissionLogProb(token)` | Unigram log-score |
| `transitionLogProb(from, to)` | Bigram log-score; `from` may be `null` |

`patterns` are trie terminals. Graph `vocabulary()` may differ.

## Indexed decode

```typescript
type IndexedDecodeContext = {
  length: number;
  matchCandidates(offset: number): MatchCandidate[];
  fallbackCandidate(offset: number): MatchCandidate | null;
  transitionWeight(from: string | null, to: string): number;
  emissionScore(token: string): number;
};

type AsyncIndexedDecodeContext = { /* async callbacks; length sync */ };
```

| Export | Description |
|--------|-------------|
| `decodeIndexed(context, options?)` | Viterbi/beam over source-atom offsets; returns `DecodeResult` |
| `decodeIndexedAsync(context, options?)` | Async equivalent |
| `decodeDetailed(text, ctx, options?)` | Text adapter over `decodeIndexed` |
| `decodeDetailedAsync(text, ctx, options?)` | Async text adapter |
| `decode(text, ctx, options?)` | `decodeDetailed(...).tokens` (incomplete → char-split fallback) |
| `decodeAsync(text, ctx, options?)` | Async `decode` |
| `viterbiDecode` / `beamDecode` | Thin wrappers over `decode` |
| `viterbiDecodeAsync` / `beamDecodeAsync` | Async wrappers |

Incomplete indexed paths return `{ complete: false, score: -Infinity, tokens: [], steps: [] }`. Invalid candidate lengths and non-positive/non-integer `beamWidth` throw `RangeError`.

When `useBigram` is `false`, transition contribution is zero.

## Compile and decode utilities

| Export | Description |
|--------|-------------|
| `buildLmTables(tokenCounts, edges, options?)` | Build LM score functions; `options.smoothing` must be finite and `> 0` |
| `terminalEntriesFromText(patterns)` | Char-grain helper: UTF-16 atoms per pattern key |
| `compilePatterns(terminals, lm)` | Build `ICompiledLattice` from `TerminalEntry[]` only |
| `tokenizeCompiled(text, compiled, options?)` | Sync decode on compiled index |
| `tokenizeCompiledAsync(text, compiled, options?)` | Async decode on compiled index |
| `AhoCorasick` | Atom-edge pattern automaton |
| `PatternVocabulary` | In-memory pattern store (`merge(atoms, pattern, markovId)`) |

## Pipeline

| Export | Description |
|--------|-------------|
| `Pipeline` | Sync sequencer-to-lattice ingest |
| `AsyncPipeline` | Async sequencer-to-lattice ingest |
| `GlobFileJob` | File glob ingest job (character stream) |
| `feedInputStream` | Feed sync lattice from `AsyncGenerator<SequencerInput>` |
| `feedInputStreamAsync` | Feed async lattice from `AsyncGenerator<SequencerInput>` |
| `feedCharacters` / `feedBytes` / `feedSymbols` | Atom feed generators |

`IJob.input()` accepts any `AsyncGenerator<SequencerInput>`. Each yield is one atom.

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
