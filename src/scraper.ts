import axios from "axios";
import fs from "fs";
import path from "path";
import pRetry from "p-retry";
import * as cliProgress from "cli-progress";
import { getScrapeConfig, ScrapeConfig } from "./cli";
import { UI } from "./ui";

// --- CLI arguments ---
const args = process.argv.slice(2);
const useInteractive = !args.includes("--no-interactive");
const projectArgIndex = args.indexOf("--projects");
const limitArgIndex = args.indexOf("--limit");

let PROJECTS: string[] = [];
let MAX_ISSUES: number | null = null;
let PER_PROJECT_LIMITS: Record<string, number> | undefined = undefined;

// Load configuration
if (useInteractive && projectArgIndex === -1 && limitArgIndex === -1) {
  // Interactive mode - get config from user
  const config: ScrapeConfig = getScrapeConfig();
  PROJECTS = config.projects;
  MAX_ISSUES = config.maxIssuesPerProject;
  PER_PROJECT_LIMITS = config.perProjectLimits;
} else {
  // Command-line mode (backward compatible)
  PROJECTS = ["SPARK", "KAFKA", "HADOOP"]; // default projects
  const projectArg = projectArgIndex !== -1 ? args[projectArgIndex + 1] : undefined;
  if (projectArg) {
    PROJECTS = projectArg.split(",");
  }

  const limitArg = limitArgIndex !== -1 ? args[limitArgIndex + 1] : undefined;
  if (limitArg) {
    MAX_ISSUES = parseInt(limitArg, 10);
    console.log(`Quick-test mode: limit to ${MAX_ISSUES} issues per project`);
  }
}

// --- Setup folders ---
const RAW_DIR = path.join(__dirname, "../data/raw");
const PROGRESS_FILE = path.join(process.cwd(), "progress.json");
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

// --- Load progress ---
let progress: Record<string, any> = {};
if (fs.existsSync(PROGRESS_FILE)) {
  progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
}

// --- Rate limiting ---
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 200; // 200ms between requests (5 req/sec max)

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Helper to fetch with retry and rate limiting ---
async function fetchPageWithRetry(url: string) {
  return pRetry(async () => {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await delay(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
    }
    lastRequestTime = Date.now();

    try {
      const resp = await axios.get(url, {
        timeout: 30000, // 30 second timeout
        validateStatus: (status) => {
          // Don't throw for 429 or 5xx, handle them in retry logic
          return status < 500 || status === 429;
        }
      });

      // Handle HTTP 429 (Too Many Requests)
      if (resp.status === 429) {
        const retryAfter = resp.headers['retry-after'] 
          ? parseInt(resp.headers['retry-after'], 10) * 1000 
          : 60000; // Default 60 seconds
        UI.warning(`Rate limited. Waiting ${retryAfter / 1000}s before retry...`);
        await delay(retryAfter);
        throw new Error('Rate limited - retrying');
      }

      // Handle 5xx errors
      if (resp.status >= 500) {
        throw new Error(`Server error: ${resp.status}`);
      }

      if (!resp.data) throw new Error("Empty response");
      return resp.data;
    } catch (error: any) {
      // Network errors or timeouts
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        throw new Error(`Network error: ${error.code}`);
      }
      throw error;
    }
  }, { 
    retries: 5, 
    minTimeout: 2000,
    maxTimeout: 60000,
    onFailedAttempt: (error) => {
      UI.warning(`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries remaining.`);
    }
  });
}

async function scrapeProject(project: string) {
  UI.section(`Scraping Project: ${project}`);
  const filePath = path.join(RAW_DIR, `${project}.json`);
  let allIssues: any[] = [];
  let startAt = progress[project]?.lastStartAt || 0;
  let totalFetched = 0;

  // Determine limit for this specific project
  const projectLimit = PER_PROJECT_LIMITS?.[project] ?? MAX_ISSUES;
  
  if (projectLimit) {
    UI.info(`Limit: ${projectLimit} issues for ${project}`);
  }

  // Estimate total issues (simplified)
  const ESTIMATED_TOTAL = projectLimit || 10000;

  const progressBar = new cliProgress.SingleBar({
    format: `${project} |{bar}| {value}/{total} issues`,
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);

  progressBar.start(ESTIMATED_TOTAL, startAt);

  while (true) {
    if (projectLimit && totalFetched >= projectLimit) break;

    // Expand fields to get all metadata: comments, priority, assignee, labels, timestamps, etc.
    const fields = [
      'summary', 'description', 'status', 'priority', 'assignee', 'reporter',
      'created', 'updated', 'resolutiondate', 'labels', 'components', 'fixVersions',
      'comment', 'issuetype', 'project', 'resolution', 'watches', 'timeoriginalestimate',
      'timespent', 'aggregatetimespent', 'aggregatetimeoriginalestimate'
    ].join(',');
    
    // Expand changelog and renderedFields to get full comment details including rendered body
    const url = `https://issues.apache.org/jira/rest/api/2/search?jql=project=${project}&startAt=${startAt}&maxResults=50&expand=changelog,renderedFields&fields=${fields}`;
    let data;
    try {
      data = await fetchPageWithRetry(url);
    } catch (err) {
      console.error(`Failed to fetch page at startAt=${startAt}`, err);
      break;
    }

    const issues = data.issues || [];
    if (issues.length === 0) break;

    allIssues.push(...issues);
    totalFetched += issues.length;
    startAt += issues.length;
    progressBar.update(totalFetched);

    // Save progress
    progress[project] = { lastStartAt: startAt };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

    if (projectLimit && totalFetched >= projectLimit) break;
  }

  progressBar.stop();
  fs.writeFileSync(filePath, JSON.stringify(allIssues, null, 2));
  UI.success(`Finished scraping ${project}: ${allIssues.length} issues saved`);
}

async function main() {
  UI.header("Jira Data Scraper", 60);
  for (const project of PROJECTS) {
    await scrapeProject(project);
    console.log(); // Blank line between projects
  }
  UI.header("Scraping Complete", 60);
  UI.success(`All ${PROJECTS.length} project(s) scraped successfully!`);
}

main().catch((err) => {
  UI.error(`Scraper failed: ${err.message}`);
  process.exit(1);
});
