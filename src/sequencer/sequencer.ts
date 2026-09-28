import type { IGate, IGateSnapshot } from "./gate";
import type { IQueue } from "./queue/queue";

export type Value = string;
export type Sentinel = `<${number}>`;
export type Key = string;
export type SequencerInput = Value | Sentinel;
export type SequencerOutput = { sequence: SequencerInput[]; key: Key };

export interface ISequencerConfig<TGates extends IGate[] = IGate[]> {
  name?: string;
  gates: TGates;
  queue: IQueue;
  /**
   * Optional delimiter inserted between atoms when composing pattern keys.
   * Default "" preserves historical string concatenation.
   */
  atomDelimiter?: string;
}

export interface ISequencerSnapshot {
  name: string;
  durationMS: number;
  gates: IGateSnapshot[];
}

export interface ISequencer {
  /**
   * The gates used to determine if a sequence should be emitted
   */
  readonly _gates: IGate[];
  /**
   * @param input The value to process or a sentinel
   */
  push(input: SequencerInput): void;
  /**
   * Emit the remaining candidate buffer (if any), clear candidate state, and wait for
   * async drain. Preserves the shared gate dictionary.
   */
  flush(): Promise<void>;
  /**
   * Sequence boundary: flush pending output and clear candidate state while preserving
   * the shared gate dictionary. Use between independent feeds that share learning.
   */
  endSequence(): Promise<void>;
  /**
   * Flushes and closes the sequencer, signaling to readers that no more data is coming.
   */
  close(): Promise<void>;
  /**
   * Discard the current candidate without emitting and clear gate dictionaries.
   */
  reset(): void;
  /**
   * @returns A snapshot of the internal state
   */
  snapshot(): Promise<ISequencerSnapshot[]>;
  /**
   * Read segmentation outputs from the queue
   */
  read(): AsyncGenerator<SequencerOutput, void, unknown>;
  /**
   * Move pending queue outputs into history (for online lattice feeding).
   */
  drainPending(): SequencerOutput[];
  /**
   * The history of segmentation outputs
   */
  readonly history: SequencerOutput[];
  /**
   * The amount of time since the first time push was called for this sequencer
   */
  durationMS: number;
}

export class Sequencer<TGates extends IGate[] = IGate[]> implements ISequencer {
  private _name: string;
  private _timeStart = 0;
  readonly _gates: TGates;
  private _queue: IQueue;
  private _atomDelimiter: string;
  constructor({ name, gates, queue, atomDelimiter = "" }: ISequencerConfig<TGates>) {
    this._name = name ?? this.constructor.name;
    this._gates = gates ?? [];
    this._queue = queue;
    this._atomDelimiter = atomDelimiter;
  }

  private _ongoingSequence: SequencerInput[] = [];
  private _ongoingKey: Key = "";
  push: ISequencer["push"] = (input) => {
    const result = Sequencer.evaluate(this._ongoingKey, input, this._gates, this._atomDelimiter);

    // Sequencer.evaluate produces a key internally and returns it in either continue or reset
    // We set _ongoingKey, which will be used in the the next push call, depending on the shape of the output.
    // The presence of continue signals we're in the middle of a known pattern, so it will be equal to the concatenated version of the ongoing sequence
    // The presence of reset signals at least one of the gates said we should segment before the input item
    // If emit is not present, there was no pattern accumulating yet and the gate did not trust the first input item
    if ("continue" in result) {
      this._ongoingKey = result.continue;
    } else if (!result.emit) {
      this._ongoingKey = result.reset;
    } else {
      this._ongoingKey = result.reset;
      this._queue.push({
        key: result.emit,

        // Splicing here avoids an assignment in exchange for readability
        // This claims the ongoing sequence to the queue and resets ongoing to empty
        sequence: this._ongoingSequence.splice(0),
      });
    }

    // Whether we continue or emit above, we still need to add the input to the ongoing sequence
    this._ongoingSequence.push(input);
  };

  static evaluate(
    previous: Key,
    input: SequencerInput,
    gates: IGate[],
    atomDelimiter = "",
  ): { reset: string; emit?: string } | { continue: string } {
    const current = previous === "" ? input : `${previous}${atomDelimiter}${input}`;
    for (let index = 0; index < gates.length; index++) {
      // Continue as long as the gate passes
      if (gates[index]?.evaluate(current, previous)) continue;

      // The last input added caused this gate to fail.
      // This is our signal to stop accumulating and segment here, assuming the input is the start of a new pattern.

      // We should never emit an empty string, but the gates are still allowed to fail on one in the case of a single input being unknown.
      // This can occur on the first input when a gate uses a cache that starts completely empty
      // In this case, we trust the gate's decision to segment here and reset the accumulator to the input but do not signal to emit
      if (previous === "") return { reset: input };

      // If there was actually a pattern accumulating, we emit it and also reset the accumulator to the input
      return { reset: input, emit: previous };
    }
    return { continue: current };
  }

  flush: ISequencer["flush"] = async () => {
    if (this._ongoingSequence.length > 0) {
      this._queue.push({
        sequence: this._ongoingSequence.splice(0),
        key: this._ongoingKey,
      });
    }
    this._ongoingKey = "";
    // Yield to event loop to allow async drain to active readers
    await Promise.resolve();
  };

  endSequence: ISequencer["endSequence"] = async () => {
    return this.flush();
  };

  close: ISequencer["close"] = async () => {
    await this.flush();
    this._queue.close();
  };

  reset: ISequencer["reset"] = () => {
    this._ongoingSequence = [];
    this._ongoingKey = "";
    this._timeStart = 0;
    this._gates.forEach((gate) => void gate.reset());
  };

  snapshot: ISequencer["snapshot"] = async () => {
    return [
      {
        name: this._name,
        gates: await Promise.all(
          this._gates.map(
            async (gate) =>
              (await gate.snapshot()) ?? {
                name: gate.constructor.name,
                ingested: 0,
                passRate: 0,
              },
          ),
        ),
        durationMS: performance.now() - this._timeStart,
      },
    ];
  };

  read(): AsyncGenerator<SequencerOutput, void, unknown> {
    return this._queue.read();
  }

  drainPending(): SequencerOutput[] {
    return this._queue.drainPending();
  }

  get history(): SequencerOutput[] {
    return this._queue.history;
  }

  get durationMS(): number {
    return performance.now() - this._timeStart;
  }
}
