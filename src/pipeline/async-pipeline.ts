import type { IAsyncLattice } from "../lattice/lattice";
import type { IDictionary } from "../lz-sequencer/dictionary/dictionary";
import type { ISequencer } from "../sequencer";
import { createFeedState, type FeedState, feedInputStreamAsync } from "./feed";
import type { IJob } from "./job";

export interface AsyncPipelineMount {
  lattice: IAsyncLattice;
  sequencer: ISequencer;
  dictionary: IDictionary;
}

export interface AsyncPipelineOptions {
  transitionBatchSize?: number;
}

type QueuedJob = { job: IJob; resolve: () => void; reject: (error: unknown) => void };

export class AsyncPipeline {
  readonly lattice: IAsyncLattice;
  readonly sequencer: ISequencer;
  readonly dictionary: IDictionary;

  private batchSize: number;
  private feedState: FeedState;
  private queue: QueuedJob[] = [];
  private processing = false;
  private drainPromise: Promise<void> | null = null;
  private drainResolve: (() => void) | null = null;

  constructor(mount: AsyncPipelineMount, options: AsyncPipelineOptions = {}) {
    this.lattice = mount.lattice;
    this.sequencer = mount.sequencer;
    this.dictionary = mount.dictionary;
    this.batchSize = options.transitionBatchSize ?? 1000;
    this.feedState = createFeedState();
  }

  async run(job: IJob): Promise<void> {
    await feedInputStreamAsync(
      this.lattice,
      this.sequencer,
      job.input(),
      this.feedState,
      this.batchSize,
    );
  }

  enqueue(job: IJob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      void this.processQueue();
    });
  }

  drain(): Promise<void> {
    if (!this.processing && this.queue.length === 0) {
      return Promise.resolve();
    }
    if (!this.drainPromise) {
      this.drainPromise = new Promise<void>((resolve) => {
        this.drainResolve = resolve;
      });
    }
    return this.drainPromise;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;

      try {
        await this.run(next.job);
        next.resolve();
      } catch (error) {
        next.reject(error);
      }
    }

    this.processing = false;

    if (this.drainResolve) {
      this.drainResolve();
      this.drainResolve = null;
      this.drainPromise = null;
    } else if (this.queue.length > 0) {
      void this.processQueue();
    }
  }
}
