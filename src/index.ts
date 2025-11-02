import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { UI } from "./ui";

const scraperPath = path.join(__dirname, "scraper.ts");
const transformerPath = path.join(__dirname, "transformer.ts");

// --- CLI flags ---
const args = process.argv.slice(2);
const forceRestart = args.includes("--force");
const skipScrape = args.includes("--skip-scrape"); // Skip scraping if raw data exists

// Delete progress.json if force restart
const progressFile = path.join(process.cwd(), "progress.json");
if (forceRestart && fs.existsSync(progressFile)) {
  UI.warning("Force restart enabled — deleting progress.json");
  fs.unlinkSync(progressFile);
}

// --- Run a script via ts-node ---
function runScript(scriptPath: string, additionalArgs: string[] = []) {
  return new Promise<void>((resolve, reject) => {
    const allArgs = [...process.argv.slice(2), ...additionalArgs].join(" ");
    const child = exec(`npx ts-node ${scriptPath} ${allArgs}`, (err, stdout, stderr) => {
      if (err) {
        console.error(stderr);
        reject(err);
      } else {
        console.log(stdout);
        resolve();
      }
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function main() {
  UI.header("Full Pipeline: Scraper → Transformer", 70);

  // Check if raw data exists
  const rawDir = path.join(process.cwd(), "data/raw");
  const hasRawData = fs.existsSync(rawDir) && 
                     fs.readdirSync(rawDir).filter(f => f.endsWith(".json")).length > 0;

  // Run scraper (unless skipping)
  if (!skipScrape) {
    UI.section("Running Scraper");
    await runScript(scraperPath);
  } else if (hasRawData) {
    UI.info("Skipping Scraper (raw data exists)");
  } else {
    UI.section("Running Scraper");
    await runScript(scraperPath);
  }

  // Run transformer
  UI.section("Running Transformer");
  await runScript(transformerPath);

  UI.header("Pipeline Complete", 70);
  UI.success("Dataset ready! Check data/processed/output.jsonl");
  console.log();
  UI.subheader("Next Steps", 70);
  UI.listItem(1, "npm run analyze  - View dataset statistics", false);
}

main().catch((err) => {
  UI.error(`Pipeline failed: ${err.message}`);
  process.exit(1);
});
