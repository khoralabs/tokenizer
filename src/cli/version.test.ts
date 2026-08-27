import { describe, expect, test } from "bun:test";

import { getPackageVersion } from "./version.ts";

describe("getPackageVersion", () => {
  test("reads version from package.json", () => {
    expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
