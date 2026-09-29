# Algorithm

Mechanics of segmentation, lattice updates, and decoding.

## Atoms

An **atom** is an opaque string edge label in the trie and Aho-Corasick automaton. One sequencer `push()` / generator yield is one atom.

| Feed | Alphabet |
|------|----------|
| `feedCharacters(text)` | UTF-16 code units |
| `feedBytes(bytes)` | Latin-1 code units (`String.fromCharCode`) |
| `feedSymbols(symbols)` | Host-provided opaque strings |

Choosing a feed chooses the matcher alphabet for that lattice. Mixing alphabets on one lattice produces incorrect matches.

`MatchCandidate.length` is an **atom count**, not JavaScript string length. Pattern keys may concatenate atoms (default) or join them with `atomDelimiter` on the sequencer.

## LZ gate segmentation

The sequencer maintains a dictionary of seen prefixes and a buffer for the current sequence.

For each input atom:

1. Form `extended` as the current pattern key plus the new atom (with optional `atomDelimiter` between atoms).
2. If the dictionary contains `extended`, keep growing. Update the pattern and add the atom to the buffer.
3. If the dictionary does not contain `extended`, emit the buffer as a segment. Add `extended` to the dictionary. Reset the buffer to the new atom.

Segmentation is greedy and single-pass. The gate returns `true` from `evaluate()` while the extended prefix is known.

## Discrete tokens and host symbols

Each `push()` or generator yield accepts one `SequencerInput` string. A string can be one logical token (for example `svc:api`) or one character. Character-by-character feed is a convention in `feedCharacters`, not a library constraint.

Hosts map domain objects to stable strings before feed. Delimiters and sentinels are host-defined. The library stores strings and builds graph nodes from ingested segment keys. Trie edges follow `sequence` atoms, not UTF-16 splits of the key.

See [Custom symbol streams](../tutorials/custom-symbol-streams.md) for discrete-token ingest.

## Dictionary

The LZ gate uses an `IDictionary` implementation:

- `Unbounded` — no size limit
- `Bounded` — evicts oldest entries at capacity

`createLZSequencer` accepts `cacheOptions` for bounded, unbounded, or custom dictionary instances.

## Gates

A gate implements `IGate.evaluate(current, previous)`. The return value is `true` to continue the prefix or `false` to segment. `LZGate` uses dictionary membership. Custom gates can apply other rules.

## Sentinels

Input may include sentinel markers in the form `<number>`. Sentinels participate in the sequence and key like other input items.

## Queue and emission

When a gate signals segmentation, the sequencer pushes `{ key, sequence }` to the queue. Consumers read outputs through `read()`. Call `await flush()` to emit the remaining buffer at end of input.

## Lattice ingest

Each emitted segment becomes a `LatticeSegment`:

```typescript
{ key: string; sequence: string[] }
```

`ingest` stores the pattern in the vocabulary and updates emission counts in the graph. Trie merge walks `sequence` as atom edges. `merge` records weighted transitions between consecutive pattern keys from a feed batch.

`commitFeedBatch` performs ingest and merge in one storage transaction.

## Language model

Decode scores use:

- **Unigram emissions** — add-k smoothed log-probability from pattern emission counts
- **Bigram transitions** — normalized log-probability from outgoing edge weights

`buildLmTables(tokenCounts, edges, { smoothing })` constructs score functions from maps. Default smoothing is `0.1`. Backends precompute these during `compile(options?)`. Non-default smoothing returns an uncached compile snapshot.

`useBigram: false` on decode options zeros the transition contribution.

## Pattern matching

`ICompiledLattice.scan(text)` converts text to UTF-16 atoms and runs Aho-Corasick. `scanAtoms(source)` runs over a host atom array. Both return match candidates `{ pattern, length }` per offset, where `length` is the atom span.

`compiled.patterns` is the terminal snapshot from compile (may diverge from live `vocabulary()` until recompile).

## Decode search

Text decode builds a layered graph over UTF-16 positions using `scan()`. Indexed decode (`decodeIndexed`) takes an abstract length and callbacks for candidates, fallback, and scores — so hosts can decode over symbol offsets.

| Mode | Behavior |
|------|----------|
| `viterbi` | Default. Retains the best path per layer. |
| `beam` | Retains up to `beamWidth` hypotheses per layer. |

Backtracking yields the token string sequence. Detailed APIs return `DecodeResult` with per-step spans and cumulative scores. Incomplete coverage yields `complete: false` and `score: -Infinity`.

See [Decode a symbol stream](../how-to/decode-symbol-stream.md).

## Hub scoring

`getTopTokens(limit)` ranks vocabulary patterns by hub score. SQLite, Turso, and memory backends use degree-based scorers by default.

## Unicode input

`Unicode.toCodepoints`, `Unicode.toString`, `Unicode.streamFile`, and `Unicode.streamGlob` support NFC-normalized character streaming for file ingest.
