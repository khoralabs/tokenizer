import type { SequencerInput } from "../../sequencer";
import { streamUnicodeGlob } from "../../unicode-reader";
import type { IJob } from "../job";

export interface GlobFileJobOptions {
  pattern: string;
  cwd?: string;
}

export class GlobFileJob implements IJob {
  private pattern: string;
  private cwd: string;

  constructor(options: GlobFileJobOptions) {
    this.pattern = options.pattern;
    this.cwd = options.cwd ?? process.cwd();
  }

  input(): AsyncGenerator<SequencerInput> {
    return streamUnicodeGlob(this.pattern, this.cwd);
  }
}
