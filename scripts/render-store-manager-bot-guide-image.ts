import path from "node:path";

import { runCommandWithTimeout } from "../src/command-runner.js";
import { buildStoreManagerBotGuidePosterImage } from "../src/store-manager-bot-guide-image.js";

async function main(): Promise<void> {
  const outputDir = path.join(process.cwd(), "tmp", "store-manager-bot-guide-image");
  const imagePath = await buildStoreManagerBotGuidePosterImage({
    outputDir,
    runCommandWithTimeout,
  });

  console.log(imagePath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
