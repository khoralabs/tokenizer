import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "../lattice/memory/lattice";
import { Lattice as TursoLattice } from "../lattice/turso/lattice";
import { Unbounded } from "../lz-sequencer/dictionary/unbounded";
import { LZGate } from "../lz-sequencer/lz-gate";
import { Queue, Sequencer } from "../sequencer";
import { AsyncPipeline } from "./async-pipeline";
import type { IJob } from "./job";
import { GlobFileJob } from "./jobs/glob-file-job";
import { Pipeline } from "./pipeline";

function createMount() {
  const dictionary = new Unbounded();
  const lattice = new Lattice();
  const sequencer = new Sequencer({
    gates: [new LZGate({ cache: dictionary })],
    queue: new Queue({ historyOptions: { bounded: false } }),
  });
  return { dictionary, lattice, sequencer };
}

class ArrayJob implements IJob {
  constructor(private chars: string) {}

  async *input() {
    for (const char of this.chars) yield char;
  }
}

describe("Pipeline", () => {
  test("run ingests job input into lattice", async () => {
    const { dictionary, lattice, sequencer } = createMount();
    const pipeline = new Pipeline({ lattice, sequencer, dictionary });

    await pipeline.run(new ArrayJob("hello hello hello "));

    expect(lattice.vocabulary().length).toBeGreaterThan(0);
    lattice.close();
  });

  test("enqueue runs jobs serially and accumulates state", async () => {
    const { dictionary, lattice, sequencer } = createMount();
    const pipeline = new Pipeline({ lattice, sequencer, dictionary });

    const first = pipeline.enqueue(new ArrayJob("abc"));
    const second = pipeline.enqueue(new ArrayJob("def"));

    await Promise.all([first, second]);

    expect(lattice.vocabulary().length).toBeGreaterThan(0);
    expect(sequencer.history.length).toBeGreaterThan(0);
    lattice.close();
  });

  test("GlobFileJob streams matching files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tkn-pipeline-"));
    await writeFile(join(dir, "a.txt"), "hello ");
    await writeFile(join(dir, "b.txt"), "world ");
    await writeFile(join(dir, "skip.bin"), "ignored");

    const { dictionary, lattice, sequencer } = createMount();
    const pipeline = new Pipeline({ lattice, sequencer, dictionary });

    await pipeline.run(new GlobFileJob({ pattern: "*.txt", cwd: dir }));

    expect(lattice.vocabulary().length).toBeGreaterThan(0);
    lattice.close();
  });
});

describe("AsyncPipeline", () => {
  test("run ingests job input into turso lattice", async () => {
    const dictionary = new Unbounded();
    const lattice = await TursoLattice.open(":memory:");
    const sequencer = new Sequencer({
      gates: [new LZGate({ cache: dictionary })],
      queue: new Queue({ historyOptions: { bounded: false } }),
    });
    const pipeline = new AsyncPipeline({ lattice, sequencer, dictionary });

    await pipeline.run(new ArrayJob("test test test "));

    expect((await lattice.vocabulary()).length).toBeGreaterThan(0);
    await lattice.close();
  });
});
