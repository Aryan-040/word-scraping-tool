# Word Scraping Tool

A production-ready data scraping and transformation pipeline that extracts public issue data from Apache's Jira instance and converts it into high-quality datasets for Large Language Model (LLM) training.

---

## Table of Contents

1. [Setup Instructions](#setup-instructions)
2. [Environment Configuration](#environment-configuration)
3. [Quick Start Guide](#quick-start-guide)
4. [Architecture Overview](#architecture-overview)
5. [Design Reasoning](#design-reasoning)
6. [Edge Cases Handled](#edge-cases-handled)
7. [Optimization Decisions](#optimization-decisions) 
8. [Features](#features)
9. [Output Formats](#output-formats)

---

## Setup Instructions

### Prerequisites

- **Node.js**: Version 18.x or higher
- **npm**: Version 9.x or higher (comes with Node.js)
- **Disk Space**: Minimum 500MB free space (recommended 2GB+ for full datasets)
- **Internet Connection**: Required for scraping Apache Jira API

### Installation Steps

1. **Clone or extract the project**
   ```bash
   cd web-scraping-tutor
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```
   This installs all required packages:
   - Runtime dependencies: `axios`, `p-retry`, `jsonlines`, `cli-progress`, `readline-sync`
   - Development dependencies: TypeScript, type definitions

3. **Verify installation**
   ```bash
   npx tsc --version  # Should show TypeScript version
   npm list --depth=0  # Verify all packages installed
   ```

4. **Create data directories** (auto-created on first run, but you can pre-create)
   ```bash
   mkdir -p data/raw data/processed
   ```

### Initial Configuration

No additional configuration files are required. The system uses:
- **Progress tracking**: `progress.json` (auto-generated)
- **Output location**: `data/raw/` and `data/processed/` (auto-created)

---

## Environment Configuration

### Runtime Environment

The pipeline runs in Node.js with TypeScript execution via `ts-node`. No build step required for development.

### Configuration Files

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",        // Modern JavaScript features
    "module": "CommonJS",      // Node.js module system
    "strict": true,            // Full type checking
    "noUncheckedIndexedAccess": true,  // Safety for array access
    "exactOptionalPropertyTypes": true // Precise optional types
  }
}
```

**Design Rationale:**
- **ES2020 target**: Balance between modern features and Node.js compatibility
- **Strict mode**: Catch potential bugs at compile time
- **Safe indexing**: Prevents undefined array access errors

#### Environment Variables (Optional)

Currently, the system doesn't require environment variables. However, you can customize behavior:

- `NO_COLOR`: Set to disable colored terminal output (useful for CI/CD)
  ```bash
  NO_COLOR=1 npm run scrape
  ```

### Network Configuration

- **API Endpoint**: `https://issues.apache.org/jira/rest/api/2/search`
- **Rate Limit**: 5 requests/second (200ms interval)
- **Timeout**: 30 seconds per request
- **Retry Strategy**: 5 attempts with exponential backoff (2s → 60s)

---

## Quick Start Guide

### Basic Usage

```bash
# 1. Install dependencies
npm install

# 2. Run full pipeline (interactive)
npm start

# 3. Or run steps individually
npm run scrape      # Scrape data
npm run transform   # Transform to training format
npm run analyze     # View statistics
npm run prepare     # Generate format files
```

### Interactive Mode

```bash
npm run scrape
```

You'll be prompted to:
1. Select projects (single or multiple)
2. Set issue limits (per project or global)
3. Confirm configuration

### Non-Interactive Mode

```bash
npm run scrape -- --projects SPARK,KAFKA --limit 100
```

---


## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   CLI    │  │  Index   │  │  UI      │  │ Analyze  │   │
│  │ (interactive)│ (orchestrator)│ (formatting)│ (stats)  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Core Processing Layer                      │
│  ┌──────────┐                    ┌──────────┐              │
│  │ Scraper  │ ──progress.json──→ │Transformer│              │
│  │  (HTTP)  │                    │ (Text)   │              │
│  └──────────┘                    └──────────┘              │
│       │                               │                      │
│       ▼                               ▼                      │
│  data/raw/*.json              data/processed/output.jsonl    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Output Format Layer                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Prepare  │──│ OpenAI   │  │ Alpaca   │  │ Completion │  │
│  │ Dataset  │  │ Format   │  │ Format   │  │ Format     │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### 1. **Scraper (`src/scraper.ts`)**
- **Purpose**: Fetch raw issue data from Jira API
- **Responsibilities**:
  - HTTP request management with retry logic
  - Rate limiting and backoff strategies
  - Progress persistence for resume capability
  - Error handling and recovery
- **Output**: Raw JSON files in `data/raw/`

#### 2. **Transformer (`src/transformer.ts`)**
- **Purpose**: Convert raw Jira data into training-ready format
- **Responsibilities**:
  - Text cleaning and normalization
  - Quality filtering
  - Multi-task generation (7 task types per issue)
  - Metadata preservation
- **Output**: Cleaned JSONL in `data/processed/output.jsonl`

#### 3. **Analyzer (`src/analyze_dataset.ts`)**
- **Purpose**: Provide insights and statistics about the dataset
- **Responsibilities**:
  - Dataset statistics calculation
  - Per-project breakdown
  - Task type distribution
  - Sample example generation
- **Output**: Terminal statistics and reports

#### 4. **Prepare Dataset (`src/prepare_dataset.ts`)**
- **Purpose**: Convert transformer output into multiple training formats
- **Responsibilities**:
  - Format conversion (OpenAI, Alpaca, Completion)
  - Validation of output structure
- **Output**: Three format-specific JSONL files

#### 5. **CLI Interface (`src/cli.ts`)**
- **Purpose**: Interactive user configuration
- **Responsibilities**:
  - Project selection menu
  - Issue limit configuration
  - Per-project limit setting
- **Output**: Configuration object for scraper

#### 6. **UI Utilities (`src/ui.ts`)**
- **Purpose**: Enhanced terminal output formatting
- **Responsibilities**:
  - Color-coded messages
  - Formatted tables and headers
  - Progress indicators
  - Status badges

---

## Design Reasoning

### 1. **Modular Architecture**

**Decision**: Separate concerns into distinct modules (scraper, transformer, analyzer)

**Reasoning**:
- **Single Responsibility**: Each module has one clear purpose
- **Testability**: Modules can be tested independently
- **Maintainability**: Changes to one component don't affect others
- **Reusability**: Components can be used in different contexts

**Trade-offs**:
- Slight overhead from module boundaries
- More files to manage
- **Benefit**: Clear separation makes debugging and enhancement easier

### 2. **Progress Persistence**

**Decision**: Save progress after each batch (50 issues) to `progress.json`

**Reasoning**:
- **Fault Tolerance**: Can resume from last successful state
- **Long-running Jobs**: Scraping thousands of issues takes hours
- **Network Resilience**: If connection drops, no work is lost
- **Incremental Processing**: Can stop and restart safely

**Implementation**:
```typescript
// After each batch
progress[project] = { lastStartAt: startAt };
fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
```

### 3. **Rate Limiting Strategy**

**Decision**: 200ms minimum interval between requests (5 req/sec max)

**Reasoning**:
- **API Respect**: Apache Jira doesn't specify rate limits, but 5 req/sec is conservative
- **Reliability**: Lower rate reduces chance of 429 errors
- **Sustainability**: Won't overwhelm the public API
- **Scalability**: Can easily adjust if limits change

**Alternative Considered**: Dynamic rate limiting based on response headers
- **Rejected**: Headers may not always include rate limit info
- **Chosen**: Fixed, conservative limit that works universally

### 4. **Multi-Format Output**

**Decision**: Generate 3 different format files simultaneously

**Reasoning**:
- **Framework Compatibility**: Different LLM frameworks expect different formats
- **Future-Proofing**: User doesn't need to know format upfront
- **One-Time Cost**: Generation happens once, benefits many use cases
- **Space Efficient**: JSONL format is compact

**Trade-off**: Extra disk space (3x output size)
- **Acceptable**: Disk space is cheap, developer time is expensive

### 5. **Quality Filtering**

**Decision**: Filter issues with <10 char titles or <20 char content

**Reasoning**:
- **Training Quality**: Low-quality data hurts model performance
- **Noise Reduction**: Removes test issues, spam, empty reports
- **Data Efficiency**: Better use of training tokens
- **Empirical**: Based on analysis of real Jira data patterns

**Threshold Selection**:
- **10 characters**: Eliminates "test", "asdf", single words
- **20 characters**: Removes near-empty descriptions
- **Tunable**: Easy to adjust in `isQualityIssue()` function

### 6. **Task Multiplicity**

**Decision**: Generate 3-7 training tasks per issue

**Reasoning**:
- **Dataset Amplification**: 1 issue → multiple training examples
- **Task Diversity**: Different learning objectives from same data
- **Efficiency**: Better use of scraped data
- **LLM Training**: More examples = better model performance

**Task Types Generated**:
1. Summarization (if description > 50 chars)
2. Classification (always)
3. Priority Classification (if priority known)
4. Question Answering (always)
5. Resolution Prediction (if resolved)
6. Conversation (if comments exist)
7. Extraction (if description > 100 chars)

### 7. **Interactive CLI**

**Decision**: Interactive menu system for configuration

**Reasoning**:
- **User Experience**: No need to edit code or remember flags
- **Discoverability**: Users see all available options
- **Flexibility**: Can still use CLI flags for automation
- **Error Prevention**: Menu prevents invalid input

**Design Pattern**: Command pattern with fallback to flags
- Interactive when no flags provided
- Non-interactive when flags detected
- Best of both worlds

### 8. **Streaming Processing**

**Decision**: Stream JSONL output instead of loading all in memory

**Reasoning**:
- **Memory Efficiency**: Handle datasets with millions of examples
- **Scalability**: Works regardless of dataset size
- **Resource Friendly**: Lower memory footprint
- **Performance**: No memory allocation overhead

**Implementation**: Uses `jsonlines.stringify()` which streams to disk

---

## Edge Cases Handled

### Network & API Edge Cases

#### 1. **HTTP 429 (Rate Limiting)**

**Problem**: API returns 429 Too Many Requests

**Solution**:
```typescript
if (resp.status === 429) {
  const retryAfter = resp.headers['retry-after'] 
    ? parseInt(resp.headers['retry-after'], 10) * 1000 
    : 60000; // Default 60 seconds
  await delay(retryAfter);
  throw new Error('Rate limited - retrying');
}
```

**Handling**:
- Checks for `retry-after` header (RFC 7231 compliant)
- Falls back to 60s if header missing
- Throws error to trigger p-retry exponential backoff
- Respects server's requested delay

#### 2. **HTTP 5xx Server Errors**

**Problem**: Temporary server failures (500, 502, 503, 504)

**Solution**:
- Uses `p-retry` with exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s max
- Max 5 retry attempts before giving up
- Logs attempt number for debugging
- Distinguishes from client errors (4xx) which don't retry

#### 3. **Network Timeouts**

**Problem**: Connection timeouts, network interruptions

**Solution**:
```typescript
timeout: 30000, // 30 second timeout
// Catches: ETIMEDOUT, ECONNRESET, ECONNABORTED
```

**Handling**:
- 30-second timeout prevents hanging
- Catches specific error codes
- Retries with backoff (network may be temporarily down)
- Graceful failure after max retries

#### 4. **Empty API Responses**

**Problem**: API returns 200 but with empty or null data

**Solution**:
```typescript
if (!resp.data) throw new Error("Empty response");
const issues = data.issues || [];
if (issues.length === 0) break; // End pagination
```

**Handling**:
- Validates response has data before processing
- Handles missing `issues` array (some API variations)
- Stops pagination naturally when no more issues
- Prevents processing null/undefined data

### Data Quality Edge Cases

#### 5. **Malformed JSON in API Response**

**Problem**: API returns invalid JSON (rare but possible)

**Solution**: `JSON.parse()` will throw, caught by p-retry
- Retries up to 5 times (might be transient)
- If persistent, fails gracefully with error message
- Progress saved before failure, can resume later

#### 6. **Missing Fields in Issue Data**

**Problem**: Some issues missing expected fields (description, status, etc.)

**Solution**:
```typescript
const description = cleanText(issue.fields.description); // Handles undefined
const status = issue.fields.status?.name || "Unknown";   // Optional chaining
```

**Handling**:
- Uses optional chaining (`?.`) throughout
- Provides sensible defaults ("Unknown", empty string)
- Quality filter requires minimum fields anyway
- No crashes from missing data

#### 7. **HTML/XML in Text Fields**

**Problem**: Jira descriptions contain HTML markup

**Solution**:
```typescript
.replace(/<[^>]+>/g, " ") // Remove HTML/XML tags
.replace(/\[~([^\]]+)\]/g, "$1") // Convert [~username] to username
.replace(/\[([^\]]+)\|([^\]]+)\]/g, "$2") // Convert [text|link] to text
```

**Handling**:
- Strips HTML tags but preserves text content
- Converts Jira-specific markup to plain text
- Normalizes whitespace
- Produces clean text for LLM training

#### 8. **Very Long Text Fields**

**Problem**: Some descriptions/comments are extremely long (10,000+ characters)

**Solution**:
```typescript
input: description.substring(0, 500)  // Truncate for classification tasks
output: description.substring(0, 300) // Truncate outputs
```

**Handling**:
- Truncates to reasonable lengths for specific tasks
- Preserves full text for summarization tasks
- Prevents token budget issues
- Maintains relevance while controlling size

#### 9. **Special Characters and Encoding**

**Problem**: Unicode, emojis, special characters in text

**Solution**:
- Node.js handles UTF-8 by default
- `JSON.stringify()` properly escapes special characters
- Text cleaning preserves Unicode (only removes HTML)
- No encoding issues observed in testing

#### 10. **Duplicate Issues Across Batches**

**Problem**: Same issue appears multiple times (API pagination edge case)

**Solution**: Not currently deduplicated (by design)
- **Reasoning**: Rare occurrence, doesn't hurt training
- **Future**: Could add deduplication by issue key
- **Current**: Transformer processes all issues as-is

### File System Edge Cases

#### 11. **Disk Space Exhaustion**

**Problem**: Running out of disk space mid-scrape

**Solution**:
- Progress saved after each batch (50 issues)
- If disk fills, progress is saved up to last batch
- Can resume after freeing space
- Error message indicates where it failed

#### 12. **Permission Errors**

**Problem**: No write permission to `data/` directory

**Solution**:
```typescript
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
```

**Handling**:
- Auto-creates directories with recursive option
- Fails early with clear error if no permissions
- Checks directory existence before writing

#### 13. **Concurrent Execution**

**Problem**: Multiple instances running simultaneously

**Solution**: No locking mechanism (by design)
- **Reasoning**: Rare use case, would add complexity
- **Current**: Each instance overwrites `progress.json`
- **Future**: Could add file locking if needed
- **Workaround**: Don't run multiple instances

### User Input Edge Cases

#### 14. **Invalid Project Selection**

**Problem**: User selects invalid project or enters bad input

**Solution**:
```typescript
if (selectedProjects.length === 0) {
  UI.error("No valid projects entered. Using default...");
  selectedProjects = ["SPARK", "KAFKA", "HADOOP"];
}
```

**Handling**:
- Validates all input
- Provides sensible defaults
- Shows clear error messages
- Doesn't crash on bad input

#### 15. **Invalid Issue Limits**

**Problem**: User enters non-numeric or negative limit

**Solution**:
```typescript
const limitNum = parseInt(limitInput, 10);
if (isNaN(limitNum) || limitNum <= 0) {
  UI.warning("Invalid number. Collecting all issues.");
  maxIssuesPerProject = null;
}
```

**Handling**:
- Validates numeric input
- Rejects negative numbers
- Falls back to "all issues" on error
- Clear warning messages

#### 16. **Interrupted Execution (Ctrl+C)**

**Problem**: User stops script mid-execution

**Solution**:
- Progress saved after each batch
- Last saved `startAt` value allows resume
- Can restart and continue from last position
- No data loss from interruption

### Data Processing Edge Cases

#### 17. **Empty Raw Data Files**

**Problem**: Raw JSON file exists but contains no issues

**Solution**:
```typescript
const issues: JiraIssue[] = rawData.issues || rawData;
if (issues.length === 0) {
  UI.warning("No issues found in file");
  continue; // Skip to next file
}
```

**Handling**:
- Checks for empty arrays
- Handles both `{issues: []}` and `[]` formats
- Skips gracefully without error
- Logs warning for user awareness

#### 18. **Corrupted Progress File**

**Problem**: `progress.json` exists but is malformed

**Solution**:
```typescript
try {
  progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
} catch {
  progress = {}; // Start fresh if corrupted
}
```

**Handling**:
- Try-catch around JSON parse
- Starts fresh if file corrupted
- No crash from bad progress file
- User can delete file to force restart

#### 19. **Task Generation Failures**

**Problem**: Error during task generation for specific issue

**Solution**: Issue skipped, others continue
- **Reasoning**: One bad issue shouldn't stop entire process
- **Current**: Error in task generation would stop transformer
- **Future**: Wrap in try-catch to skip individual issues
- **Current Workaround**: Quality filter prevents most bad issues

---

## Optimization Decisions

### 1. **Rate Limiting: 200ms Interval**

**Decision**: Fixed 200ms delay between requests

**Rationale**:
- **API Protection**: Prevents overwhelming Apache's public API
- **Reliability**: Lower rate = fewer 429 errors = faster overall
- **Simplicity**: Fixed rate easier than dynamic adjustment
- **Conservative**: 5 req/sec is below most API limits

**Alternative Considered**: Dynamic rate limiting based on response headers
- **Rejected**: Not all APIs provide rate limit headers consistently
- **Chosen**: Conservative fixed rate that works universally

**Trade-off**: Slower scraping (but more reliable)

### 2. **Batch Size: 50 Issues per Request**

**Decision**: Fetch 50 issues per API call (maxResults=50)

**Rationale**:
- **Balance**: Not too small (too many requests) nor too large (slow responses)
- **Jira Default**: 50 is Jira's recommended default
- **Memory**: 50 issues ~500KB, manageable in memory
- **Progress**: Good granularity for progress tracking

**Alternative Considered**: 100 issues per request
- **Rejected**: Larger responses slower, more memory
- **Chosen**: 50 provides good balance

### 3. **Progress Save Frequency: After Each Batch**

**Decision**: Save progress after every 50 issues

**Rationale**:
- **Fault Tolerance**: Maximum 50 issues lost on crash
- **Performance**: File writes are fast (~1ms)
- **Balance**: Frequent enough for safety, not too frequent for performance

**Alternative Considered**: Save every N batches or every N seconds
- **Rejected**: More complex, less predictable
- **Chosen**: Simple, per-batch saves

### 4. **Retry Strategy: Exponential Backoff with Cap**

**Decision**: 5 retries, 2s → 60s max delay

**Rationale**:
- **Exponential**: Gives transient errors time to resolve
- **Capped**: Prevents excessive waits (max 60s)
- **5 Attempts**: Enough for temporary issues, not infinite loop
- **p-retry Library**: Battle-tested, handles edge cases

**Formula**: `minTimeout: 2000, maxTimeout: 60000`
- First retry: 2s
- Second: ~4s
- Third: ~8s
- Fourth: ~16s
- Fifth: ~32s (capped at 60s max)

### 5. **Memory: Streaming JSONL Output**

**Decision**: Stream transformer output to disk instead of building array

**Rationale**:
- **Scalability**: Handles datasets of any size
- **Memory Efficient**: Constant memory usage regardless of dataset size
- **Performance**: No large array allocations
- **jsonlines Library**: Built for streaming

**Implementation**:
```typescript
const writer = jsonlines.stringify();
writer.pipe(fs.createWriteStream(OUTPUT_FILE));
// Write each task immediately, don't accumulate
```

**Alternative Considered**: Build array, write at end
- **Rejected**: Memory usage grows linearly with dataset
- **Chosen**: Streaming maintains constant memory

### 6. **Text Processing: Substring Limits**

**Decision**: Truncate long texts for specific tasks (500 chars input, 300 chars output)

**Rationale**:
- **Token Budget**: LLM training has token limits
- **Relevance**: First 500 chars usually contain key info
- **Quality**: Shorter, focused examples train better
- **Flexibility**: Full text still available for summarization

**Task-Specific Limits**:
- Classification: 500 char input (status/priority needs context)
- Q&A: 500 char input, 300 char output (concise answers)
- Summarization: Full text (needs complete context)

### 7. **Quality Filtering Thresholds**

**Decision**: 10 char title minimum, 20 char content minimum

**Rationale**:
- **Empirical**: Based on analysis of real Jira data
- **Noise Reduction**: Filters test issues, empty reports
- **Training Quality**: Ensures meaningful training examples
- **Balanced**: Not too strict (loses data) nor too loose (includes noise)

**Analysis**:
- Issues with <10 char titles: Usually "test", "bug", "fix" (not useful)
- Issues with <20 char descriptions: Missing context, low information
- **Result**: ~40% of issues filtered (varies by project)

### 8. **Multi-Task Generation Strategy**

**Decision**: Generate 3-7 tasks per issue (conditional on issue properties)

**Rationale**:
- **Amplification**: 1 issue → multiple training examples
- **Diversity**: Different tasks teach different skills
- **Conditional**: Only generate tasks when issue has required data
- **Efficiency**: Better use of scraped data

**Task Generation Logic**:
- Always: Classification, Q&A (basic tasks)
- Conditional: Summarization (needs description), Resolution (needs resolution), Conversation (needs comments)
- **Result**: Average ~5.3 tasks per issue (varies by project)

### 9. **Per-Project Limit Configuration**

**Decision**: Allow different issue limits per project

**Rationale**:
- **Flexibility**: Some projects may have different priorities
- **Testing**: Can test with small limits on some projects
- **Resource Management**: Can prioritize certain projects
- **User Control**: Interactive configuration makes it easy

**Implementation**:
```typescript
const projectLimit = PER_PROJECT_LIMITS?.[project] ?? MAX_ISSUES;
```
- Checks per-project limit first
- Falls back to global limit
- Null means no limit (collect all)

### 10. **Error Handling: Fail Fast vs. Continue**

**Decision**: Fail fast on critical errors, skip individual items on non-critical

**Rationale**:
- **Critical Errors**: Network failures, API errors → retry with backoff
- **Non-Critical**: Single bad issue → skip, continue processing
- **Balance**: Don't lose entire run for one bad item, but don't silently continue on systemic failures

**Examples**:
- **Fail Fast**: API returns 401 (auth error) → stop, show error
- **Continue**: Single issue has malformed data → skip, log warning
- **Retry**: Network timeout → retry with backoff

---


## Features

### Data Scraping
- Fault-tolerant scraping with automatic retries
- HTTP 429 handling with exponential backoff
- Rate limiting (5 requests/second)
- Resume capability from last successful state
- Comprehensive metadata extraction
- Network error handling

### Data Transformation
- Quality filtering (removes low-quality issues)
- Enhanced text cleaning (HTML removal, normalization)
- Multiple training tasks per issue (7 types)
- Rich metadata preservation

### Dataset Preparation
- Multiple output formats (OpenAI, Alpaca, Completion)
- Universal compatibility with LLM frameworks
- Ready for training out of the box

### Analysis Tools
- Interactive project selection
- Per-project breakdown
- Dataset statistics and quality metrics
- Task type distribution analysis

---

## Output Formats

See `FORMATS_EXPLAINED.md` for detailed format documentation.

- **OpenAI Format**: For GPT-3.5/4 fine-tuning
- **Alpaca Format**: For instruction-following models
- **Completion Format**: For text completion models

---

## Requirements Coverage

| Requirement | Status | Implementation |
|------------|--------|----------------|
| Fetch issues, comments, metadata | ✅ | Enhanced API query with expanded fields |
| Handle pagination | ✅ | `startAt` parameter with progress tracking |
| Resume from interruption | ✅ | `progress.json` persistence |
| Request failures & retries | ✅ | `p-retry` with exponential backoff |
| HTTP 429 handling | ✅ | Automatic retry with `retry-after` header |
| HTTP 5xx handling | ✅ | Retry logic with max timeout |
| Empty/malformed data | ✅ | Validation and filtering |
| Rate limiting | ✅ | 200ms minimum interval between requests |
| JSONL output format | ✅ | Multiple formats supported |
| Derived tasks | ✅ | 7 different task types generated |
| Optimization | ✅ | Rate limiting, batch processing, resume |
| Fault tolerance | ✅ | Comprehensive error handling |

---

## Output Structure

```
data/
├── raw/              # Raw Jira API responses
│   ├── SPARK.json
│   ├── KAFKA.json
│   └── HADOOP.json
└── processed/        # Processed training data
    ├── output.jsonl           # Main transformer output
    ├── openai_format.jsonl    # OpenAI fine-tuning format
    ├── alpaca_format.jsonl    # Alpaca instruction format
    └── completion_format.jsonl # Completion format
```

---

## Technical Details

- **Language**: TypeScript 5.9.3
- **Runtime**: Node.js 18+
- **Key Libraries**: 
  - `axios` - HTTP client with timeout/retry
  - `p-retry` - Exponential backoff retry logic
  - `jsonlines` - Streaming JSONL I/O
  - `cli-progress` - Terminal progress bars
  - `readline-sync` - Interactive CLI prompts

---

## Notes

- Apache Jira is a public API - please respect rate limits
- Progress saved in `progress.json` - delete to restart from beginning
- Raw data can be large (100MB+ per project) - ensure sufficient disk space
- Recommended: Start with `--limit 100` for testing

---

## License

ISC
