export type IndustryContextImportCliOptions = {
  inputPaths: string[];
};

export function renderIndustryContextImportUsage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/import-industry-context.ts --input data/industry-context/2026-04-24-initial.json [--input another.json]",
  ].join("\n");
}

export function parseIndustryContextImportArgs(
  argv: string[],
): IndustryContextImportCliOptions {
  const inputPaths: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || token === "--") {
      continue;
    }
    if (token === "--input") {
      const inputPath = argv[index + 1];
      if (!inputPath || inputPath === "--") {
        throw new Error("--input requires a path");
      }
      inputPaths.push(inputPath);
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return {
        inputPaths: [],
      };
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (inputPaths.length === 0) {
    throw new Error("At least one --input path is required");
  }

  return {
    inputPaths,
  };
}
