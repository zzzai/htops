import { describe, expect, it } from "vitest";

import { parseIndustryContextImportArgs } from "./import-industry-context-cli.js";

describe("parseIndustryContextImportArgs", () => {
  it("ignores pnpm's standalone double-dash token", () => {
    expect(
      parseIndustryContextImportArgs([
        "--",
        "--input",
        "data/industry-context/2026-04-24-initial.json",
      ]),
    ).toEqual({
      inputPaths: ["data/industry-context/2026-04-24-initial.json"],
    });
  });
});
