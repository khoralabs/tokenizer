import { expect } from "bun:test";

export interface LatticeLike {
  merge(pairs: [string, string][]): void | Promise<void>;
  getNext(
    from: string,
  ): { to: string; weight: number }[] | Promise<{ to: string; weight: number }[]>;
  nextCharacters(prefix: string): string[] | Promise<string[]>;
  getTopTokens(
    limit?: number,
  ): { pattern: string; confidence: number }[] | Promise<{ pattern: string; confidence: number }[]>;
  close(): void | Promise<void>;
}

export async function expectLatticeBasics(create: () => LatticeLike | Promise<LatticeLike>) {
  const lattice = await create();

  await lattice.merge([
    ["hello", "world"],
    ["world", "wide"],
  ]);

  expect(await lattice.getNext("hello")).toEqual([{ to: "world", weight: 1 }]);
  expect(await lattice.getNext("world")).toEqual([{ to: "wide", weight: 1 }]);
  expect(await lattice.getNext("missing")).toEqual([]);

  expect(await lattice.nextCharacters("hel")).toEqual(["l"]);
  expect(await lattice.nextCharacters("helios")).toEqual([]);

  const top = await lattice.getTopTokens(3);
  expect(top).toHaveLength(3);
  expect(top.map((row) => row.pattern)).toEqual(["hello", "world", "wide"]);
  expect(top[0]?.confidence).toBeGreaterThan(top[2]?.confidence ?? 0);
  expect(top[1]?.confidence).toBeGreaterThan(top[2]?.confidence ?? 0);

  await lattice.close();
}
