import { spawn } from "node:child_process";

export type StandaloneCommandResult = {
  pid?: number;
  code: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  killed: boolean;
  termination: "exit" | "timeout" | "no-output-timeout" | "signal";
  noOutputTimedOut?: boolean;
};

export type StandaloneCommandOptions = {
  timeoutMs: number;
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  noOutputTimeoutMs?: number;
};

export async function runCommandWithTimeout(
  argv: string[],
  options: StandaloneCommandOptions,
): Promise<StandaloneCommandResult> {
  if (argv.length === 0) {
    throw new Error("argv must not be empty");
  }

  return await new Promise<StandaloneCommandResult>((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let killed = false;
    let noOutputTimedOut = false;
    let termination: StandaloneCommandResult["termination"] = "exit";
    let timeoutHandle: NodeJS.Timeout | undefined;
    let noOutputHandle: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (noOutputHandle) {
        clearTimeout(noOutputHandle);
      }
    };

    const refreshNoOutputTimer = () => {
      if (!options.noOutputTimeoutMs) {
        return;
      }
      if (noOutputHandle) {
        clearTimeout(noOutputHandle);
      }
      noOutputHandle = setTimeout(() => {
        if (finished) {
          return;
        }
        killed = true;
        noOutputTimedOut = true;
        termination = "no-output-timeout";
        child.kill("SIGTERM");
      }, options.noOutputTimeoutMs);
    };

    timeoutHandle = setTimeout(() => {
      if (finished) {
        return;
      }
      killed = true;
      termination = "timeout";
      child.kill("SIGTERM");
    }, options.timeoutMs);
    refreshNoOutputTimer();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      refreshNoOutputTimer();
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      refreshNoOutputTimer();
    });
    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimers();
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimers();
      resolve({
        pid: child.pid,
        code,
        stdout,
        stderr,
        signal,
        killed,
        termination: signal && !killed ? "signal" : termination,
        noOutputTimedOut,
      });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
