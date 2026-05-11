# Job Scout

An automated job-hunting pipeline. Given a list of target companies, it finds each company's careers page, scrapes live job listings, uses Claude to match them against your personal criteria, and writes the top matches to a Google Sheet in real time.

Built with Node.js, the Anthropic API, and a handful of job-board APIs. No frameworks, no frontend — just a CLI tool that does the legwork so you don't have to check 60 career pages manually.

## How it works

The pipeline runs four steps per company:

1. **Find the careers URL** — Checks Greenhouse, Lever, and Ashby for a matching public job board, then falls back to an [EXA](https://exa.ai) web search. Companies with non-standard pages can be pinned in `custom_urls.json` to bypass detection entirely.

2. **Scrape live jobs** — Each ATS has its own extraction path. Greenhouse and Lever expose public JSON APIs; Ashby and Next.js sites are parsed from page HTML; everything else falls back to [Firecrawl](https://firecrawl.dev).

3. **Match against your criteria** — Sends each job plus your `criteria.md` file to Claude. Returns a score (0–100) and reasoning per job. Only roles scoring 60+ are kept.

4. **Write results** — Streams matches to two Google Sheets tabs as each company is processed: **Companies** (status, URL, ATS type, match count) and **Job Matches** (one row per scored match). A markdown report mode is available as a fallback.

## Usage

```bash
# Full pipeline — reads companies from the Google Sheet
node index.js

# Run only specific rows from the sheet
node index.js --rows 2-5

# Test a single company
node index.js --company "Notion"

# Use mock data, no real scraping
node index.js --mock

# Skip Sheets — read companies.txt and write a markdown report
node index.js --no-sheets
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your `.env` file

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

You'll need:
- **Anthropic API key** (required) — for AI matching
- **Firecrawl API key** (required for non-standard career pages) — [get one here](https://firecrawl.dev)
- **EXA API key** (optional) — used as a fallback for finding career page URLs

### 3. Set up Google Sheets (optional)

If you want results written to a Google Sheet:

1. Create a Google Cloud service account and download the JSON credentials
2. Save it as `service_account.json` in this directory
3. Add the `GOOGLE_SHEET_ID` to your `.env` file
4. Share your Google Sheet with the service account email
5. Run the one-time setup to create tabs and headers:

```bash
node setupSheets.js
```

If you skip this step, use `--no-sheets` mode — it reads from `companies.txt` and writes markdown reports to `output/`.

### 4. Define your criteria

Copy the example and customize it with your own preferences:

```bash
cp criteria.example.md criteria.md
```

The AI matcher reads this file to decide which jobs are a good fit. Be specific about role types, seniority, location, and dealbreakers.

### 5. Add your target companies

Either add them to the Google Sheet's Companies tab, or list them in `companies.txt` (one per line) for `--no-sheets` mode.

## Project structure

```
├── index.js              ← Main orchestrator
├── findCareersUrl.js     ← Step 1: find the careers page
├── scrapeJobs.js         ← Step 2: fetch job listings
├── matchJobs.js          ← Step 3: AI matching via Claude
├── generateReport.js     ← Step 4: markdown report (--no-sheets mode)
├── sheetsClient.js       ← Google Sheets read/write
├── setupSheets.js        ← One-time sheet setup
├── mockJobs.js           ← Fake job data for testing
├── custom_urls.json      ← Manual URL overrides for tricky career pages
├── companies.txt         ← Fallback company list
├── criteria.example.md   ← Template for job criteria
├── .env.example          ← Template for API keys
└── output/               ← Markdown reports (--no-sheets mode)
```

## Design decisions

**ATS detection order: Greenhouse → Lever → Ashby → fallback.** The known platforms expose clean APIs or embedded data, so they're cheap and reliable. Firecrawl-based HTML scraping is the last resort — it's slower, costs credits, and breaks when sites change.

**Google Sheets as the live output.** Results stream to the sheet per company rather than being written at the end. Partial progress survives a crash, and a long run can be monitored in real time.

**`custom_urls.json` as a permanent override layer.** When auto-detection gets a company wrong (wrong ATS, unusual slug, acquired company), pin the correct URL here. Unlike the sheet-based URL cache, these overrides are checked first and never expire.

**Match-score threshold of 60.** Claude scores every job against your criteria and explains its reasoning. The threshold filters noise without being so aggressive that edge-case roles get dropped.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not find careers page" | Company isn't on a known ATS and EXA didn't find it. Add it to `custom_urls.json` with the correct URL. |
| Wrong jobs showing for a company | Clear column C in the Google Sheet for that row and rerun. The pipeline will rediscover the URL. |
| "Rate limit hit" | Increase `DELAY_MS` in `index.js` (default: 2000ms). |
| Matching returns nothing despite many jobs | The matcher caps at 50 jobs per company. For large boards, raise `MAX_JOBS_TO_SEND_TO_AI` in `index.js`. |
