import { join } from "node:path";

/**
 * Convert a text string into an array of Unicode codepoints
 * Each codepoint is a number that represents one logical character
 */
export function toCodepoints(text: string): number[] {
  const codepoints: number[] = [];
  for (let i = 0; i < text.length; i++) {
    codepoints.push(
      text[i]?.codePointAt(0) ??
        (() => {
          throw new Error("Out of range");
        })(),
    );
  }
  return codepoints;
}

/**
 * Convert an array of Unicode codepoints back to a string
 */
export function codepointsToString(codepoints: number[]): string {
  return String.fromCodePoint(...codepoints);
}

/**
 * Stream a file, character by character, normalizing the text to NFC
 */
export async function* streamUnicodeFile(file: Bun.BunFile | File) {
  const textStream = file.stream().pipeThrough(new TextDecoderStream());
  const reader = textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const text = value.normalize("NFC");
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char !== undefined) yield char;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream characters from all files matching a glob pattern (NFC-normalized).
 */
export async function* streamUnicodeGlob(pattern: string, cwd = process.cwd()) {
  const glob = new Bun.Glob(pattern);
  for await (const path of glob.scan({ cwd, onlyFiles: true })) {
    const filePath = path.startsWith("/") ? path : join(cwd, path);
    for await (const char of streamUnicodeFile(Bun.file(filePath))) {
      yield char;
    }
  }
}

/** Unicode-aware text reader utilities */
export const Unicode = {
  toCodepoints,
  toString: codepointsToString,
  streamFile: streamUnicodeFile,
  streamGlob: streamUnicodeGlob,
};
