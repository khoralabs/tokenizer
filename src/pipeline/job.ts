import type { SequencerInput } from "../sequencer";

export interface IJob {
  /** Stream consumed by the pipeline sequencer (characters or sentinels) */
  input(): AsyncGenerator<SequencerInput>;
}
