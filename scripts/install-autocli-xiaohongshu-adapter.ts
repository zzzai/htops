import { installAutocliXiaohongshuAdapter } from "../src/install-autocli-xiaohongshu-adapter-script.js";

async function main(): Promise<void> {
  const result = await installAutocliXiaohongshuAdapter({
    log: (line) => console.log(line),
  });
  console.log(`source=${result.sourcePath}`);
  console.log(`target=${result.targetPath}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
