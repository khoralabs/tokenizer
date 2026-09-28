import { describe, expect, test } from "bun:test";
import { feedBytes, feedCharacters, feedSymbols } from "./feeds";

async function collect(source: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe("feeds", () => {
  test("feedCharacters yields UTF-16 code units", async () => {
    expect(await collect(feedCharacters("ab"))).toEqual(["a", "b"]);
  });

  test("feedBytes yields Latin-1 atoms", async () => {
    expect(await collect(feedBytes(Uint8Array.of(0x61, 0xff)))).toEqual(["a", "\xff"]);
  });

  test("feedSymbols yields opaque atoms unchanged", async () => {
    expect(await collect(feedSymbols(["foo|", "bar|"]))).toEqual(["foo|", "bar|"]);
  });

  test("feedSymbols rejects empty atoms", async () => {
    await expect(async () => {
      for await (const _ of feedSymbols([""])) {
        // drain
      }
    }).toThrow("empty symbol");
  });
});
