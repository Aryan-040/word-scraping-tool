import fs from "fs";
import path from "path";
import jsonlines from "jsonlines";
import { UI } from "./ui";

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: string;
    status?: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string; emailAddress?: string; accountId?: string } | null;
    reporter?: { displayName: string; emailAddress?: string; accountId?: string } | null;
    project?: { key: string; name: string };
    issuetype?: { name: string };
    created?: string;
    updated?: string;
    resolutiondate?: string;
    resolution?: { name: string } | null;
    labels?: string[];
    components?: { name: string }[];
    comment?: { 
      comments?: Array<{ 
        id?: string;
        body: string; 
        author?: { displayName: string; emailAddress?: string; accountId?: string; key?: string };
        created?: string;
        updated?: string;
        updateAuthor?: { displayName: string; emailAddress?: string; accountId?: string } | null;
        visibility?: { type: string; value: string };
      }>;
      maxResults?: number;
      total?: number;
      startAt?: number;
    };
    renderedFields?: {
      description?: string;
      comment?: {
        comments?: Array<{
          body?: string;
        }>;
      };
    };
  };
}

const RAW_DIR = path.join(__dirname, "../data/raw");
const OUTPUT_DIR = path.join(__dirname, "../data/processed");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "output.jsonl");

// Enhanced text cleaning with HTML/XML tag removal
function cleanText(text?: string): string {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, " ") // Remove HTML/XML tags
    .replace(/\[~([^\]]+)\]/g, "$1") // Convert [~username] to username
    .replace(/\[([^\]]+)\|([^\]]+)\]/g, "$2") // Convert [text|link] to text
    .replace(/[\r\n]+/g, " ") // Remove newlines
    .replace(/\s{2,}/g, " ") // Collapse extra spaces
    .trim();
}

// Quality filter: minimum requirements for training data
function isQualityIssue(issue: JiraIssue): boolean {
  const hasTitle = !!(issue.fields.summary && issue.fields.summary.trim().length > 10);
  const hasContent = !!(issue.fields.description && issue.fields.description.trim().length > 20) ||
                     !!(issue.fields.comment?.comments && issue.fields.comment.comments.length > 0);
  return hasTitle && hasContent;
}

// Generate multiple training tasks per issue for better LLM training
function generateTrainingTasks(issue: JiraIssue) {
  const title = cleanText(issue.fields.summary);
  const description = cleanText(issue.fields.description);
  const status = issue.fields.status?.name || "Unknown";
  const priority = issue.fields.priority?.name || "Unknown";
  const project = issue.fields.project?.key || "Unknown";
  // Extract comments with full metadata
  const comments = issue.fields.comment?.comments?.map(c => ({
    id: c.id,
    author: c.author?.displayName || "Anonymous",
    author_email: c.author?.emailAddress,
    author_accountId: c.author?.accountId,
    body: cleanText(c.body),
    body_raw: c.body, // Keep raw body for reference
    created: c.created,
    updated: c.updated,
    updateAuthor: c.updateAuthor?.displayName,
    visibility: c.visibility
  })) || [];
  
  const allText = [title, description, ...comments.map(c => c.body)].filter(Boolean).join(" ");
  
  const tasks = [];

  // 1. Summarization task
  if (description.length > 50) {
    tasks.push({
      task_type: "summarization",
      instruction: "Summarize the following technical issue in 2-3 sentences:",
      input: `${title}\n\n${description}`,
      output: title,
      metadata: { issue_id: issue.key, project, status }
    });
  }

  // 2. Classification task (status)
  tasks.push({
    task_type: "classification",
    instruction: "Classify the status of this issue based on its description:",
    input: `${title}\n\n${description.substring(0, 500)}`,
    output: status,
    metadata: { issue_id: issue.key, project, status }
  });

  // 3. Priority classification
  if (priority !== "Unknown") {
    tasks.push({
      task_type: "priority_classification",
      instruction: "Determine the priority level of this issue:",
      input: `${title}\n\n${description.substring(0, 500)}`,
      output: priority,
      metadata: { issue_id: issue.key, project, priority }
    });
  }

  // 4. QnA task
  tasks.push({
    task_type: "question_answering",
    instruction: "Answer the following question about this issue:",
    input: `What is the main problem described in this issue?\n\nIssue: ${title}\n\n${description.substring(0, 500)}`,
    output: description.substring(0, 300),
    metadata: { issue_id: issue.key, project }
  });

  // 5. Issue resolution prediction (if resolved)
  if (issue.fields.resolution?.name) {
    tasks.push({
      task_type: "resolution_prediction",
      instruction: "Based on the issue description, predict if it would be resolved:",
      input: `${title}\n\n${description.substring(0, 500)}`,
      output: issue.fields.resolution.name,
      metadata: { issue_id: issue.key, project, resolution: issue.fields.resolution.name }
    });
  }

  // 6. Multi-turn conversation (if comments exist)
  if (comments.length > 0) {
    const conversation = comments.slice(0, 5).map((c, i) => ({
      role: i === 0 ? "user" : "assistant",
      content: c.body.substring(0, 300)
    }));
    const lastComment = comments[comments.length - 1];
    if (lastComment) {
      tasks.push({
        task_type: "conversation",
        instruction: "Continue the conversation about this technical issue:",
        input: `${title}\n\n${description.substring(0, 200)}\n\nConversation:\n${conversation.map(c => `${c.role}: ${c.content}`).join("\n")}`,
        output: lastComment.body.substring(0, 300),
        metadata: { issue_id: issue.key, project, comment_count: comments.length }
      });
    }
  }

  // 7. Technical detail extraction
  if (description.length > 100) {
    tasks.push({
      task_type: "extraction",
      instruction: "Extract key technical details from this issue:",
      input: description.substring(0, 800),
      output: title,
      metadata: { issue_id: issue.key, project }
    });
  }

  return tasks;
}

async function transform() {
  UI.header("Data Transformation", 60);
  if (!fs.existsSync(RAW_DIR)) {
    UI.error("No raw data found. Please run scraper first.");
    process.exit(1);
  }
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const writer = jsonlines.stringify();
  writer.pipe(fs.createWriteStream(OUTPUT_FILE));

  const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    UI.warning("No raw JSON files found in data/raw");
    return;
  }

  UI.info(`Found ${files.length} raw data file(s) to process\n`);

  let totalIssues = 0;
  let totalTasks = 0;
  let skippedLowQuality = 0;

  for (const file of files) {
    UI.processing(`Processing ${file}...`);
    const filePath = path.join(RAW_DIR, file);
    const rawData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const issues: JiraIssue[] = rawData.issues || rawData;

    for (const issue of issues) {
      // Quality filter
      if (!isQualityIssue(issue)) {
        skippedLowQuality++;
        continue;
      }

      // Extract comprehensive metadata including full comment details
      const comments = issue.fields.comment?.comments?.map(c => ({
        id: c.id,
        author: {
          displayName: c.author?.displayName || "Anonymous",
          emailAddress: c.author?.emailAddress,
          accountId: c.author?.accountId
        },
        body: cleanText(c.body),
        body_raw: c.body, // Keep raw body for reference
        created: c.created,
        updated: c.updated,
        updateAuthor: c.updateAuthor ? {
          displayName: c.updateAuthor.displayName,
          emailAddress: c.updateAuthor.emailAddress,
          accountId: c.updateAuthor.accountId
        } : null,
        visibility: c.visibility
      })) || [];

      const metadata = {
        issue_id: issue.key || issue.id,
        project: issue.fields.project?.key || file.replace(".json", ""),
        project_name: issue.fields.project?.name,
        issue_type: issue.fields.issuetype?.name,
        status: issue.fields.status?.name || "Unknown",
        priority: issue.fields.priority?.name,
        assignee: issue.fields.assignee ? {
          displayName: issue.fields.assignee.displayName,
          emailAddress: issue.fields.assignee.emailAddress,
          accountId: issue.fields.assignee.accountId
        } : null,
        reporter: issue.fields.reporter ? {
          displayName: issue.fields.reporter.displayName || "Anonymous",
          emailAddress: issue.fields.reporter.emailAddress,
          accountId: issue.fields.reporter.accountId
        } : { displayName: "Anonymous" },
        created: issue.fields.created,
        updated: issue.fields.updated,
        resolved: issue.fields.resolutiondate,
        resolution: issue.fields.resolution?.name,
        labels: issue.fields.labels || [],
        components: issue.fields.components?.map(c => c.name) || [],
        comment_count: comments.length,
        comments: comments // Include full comment data in metadata
      };

      // Generate training tasks
      const tasks = generateTrainingTasks(issue);
      
      // Write each task as a separate entry
      for (const task of tasks) {
        const item = {
          ...task,
          metadata: {
            ...metadata,
            ...task.metadata
          }
        };
        writer.write(item);
        totalTasks++;
      }

      totalIssues++;
    }
  }

  writer.end();
  UI.header("Transformation Complete", 60);
  UI.keyValue("Issues processed", totalIssues);
  UI.keyValue("Training tasks generated", totalTasks);
  UI.keyValue("Low quality issues skipped", skippedLowQuality);
  UI.keyValue("Output file", OUTPUT_FILE);
  UI.success("Dataset ready for training!");
}

transform().catch(err => {
  UI.error(`Transformer failed: ${err.message}`);
  process.exit(1);
});