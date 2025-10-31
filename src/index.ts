import "dotenv/config";
import { runWeekly } from "./jobs/weekly.js";

const run = process.env.RUN ?? "weekly";

(async () => {
  if (run === "weekly") await runWeekly();
})();