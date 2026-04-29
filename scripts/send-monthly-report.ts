import { runSendMonthlyReportScript } from "../src/send-monthly-report-script.js";

void runSendMonthlyReportScript(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
