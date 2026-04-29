import { describe, expect, it } from "vitest";

import { runCommandWithTimeout } from "./command-runner.js";

describe("standalone command runner", () => {
  it("runs a local command successfully", async () => {
    const result = await runCommandWithTimeout(
      [
        process.execPath,
        "-e",
        'process.stdout.write("ok")',
      ],
      { timeoutMs: 5_000 },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("terminates commands that exceed timeout", async () => {
    const result = await runCommandWithTimeout(
      [
        process.execPath,
        "-e",
        "setTimeout(() => process.stdout.write('late'), 2000)",
      ],
      { timeoutMs: 100 },
    );

    expect(result.code).not.toBe(0);
    expect(result.termination).toBe("timeout");
    expect(result.killed).toBe(true);
  });
});
