# Job Scout

A job-hunting pipeline. Given a list of companies (from a Google Sheet, or `companies.txt` as a fallback), it finds each company's careers page, scrapes the live job listings, uses Claude to match them against a personal criteria file, and writes the top matches back to the sheet in real time.

---

## How it works

The pipeline runs four steps per company:

1. **Find the careers URL** — `findCareersUrl.js`. Checks Greenhouse → Lever → Ashby for a matching public board, then falls back to an EXA web search. Companies with non-standard pages can be pinned in `custom_urls.json` to bypass detection entirely.
2. **Scrape live jobs** — `scrapeJobs.js`. Each ATS has its own extraction path: Greenhouse and Lever expose public JSON APIs; Ashby and Next.js sites parse data out of page HTML; everything else falls back to Firecrawl.
3. **Match against criteria** — `matchJobs.js`. Sends each job (capped at the first `MAX_JOBS_TO_SEND_TO_AI`) plus the contents of `criteria.md` to Claude. Returns structured JSON with a score and reason per job. Only roles scoring 60+ are kept.
4. **Write results** — `sheetsClient.js`, or `generateReport.js` when `--no-sheets` is set. Results stream to two Google Sheets tabs as each company is processed: `Companies` (status, URL, ATS type, match count) and `Job Matches` (one row per match).

---

## How to run

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

Run commands from inside `files/`, not the parent `job-search/` folder. For current project state and recent changes, see `context.md`.

---

## Project structure

```
files/
├── CLAUDE.md                  ← you are here
├── context.md                 ← live project state (updated each session)
├── companies.txt              ← fallback company list (used with --no-sheets)
├── criteria.md                ← what kinds of roles to match (git-ignored; use criteria.example.md as template)
├── criteria.example.md        ← template for criteria.md
├── custom_urls.json           ← manual URL overrides for non-standard career pages
├── package.json
├── .env                       ← API keys + Google Sheet ID (never commit)
├── service_account.json       ← Google auth credentials (never commit)
├── .gitignore
├── README.md                  ← public-facing project overview (for GitHub)
├── index.js                   ← main orchestrator
├── sheetsClient.js            ← Google Sheets read/write wrapper
├── setupSheets.js             ← one-time setup: creates the two tabs and headers
├── findCareersUrl.js          ← Step 1: find the careers page
├── scrapeJobs.js              ← Step 2: fetch job listings
├── matchJobs.js               ← Step 3: AI matching via Claude API
├── generateReport.js          ← Step 4: write markdown report (--no-sheets only)
├── mockJobs.js                ← fake job data for testing
└── output/                    ← markdown reports land here in --no-sheets mode
```

---

## Key design decisions

**ATS detection order: Greenhouse → Lever → Ashby → fallback.** The known platforms expose clean APIs or embedded data, so they're cheap and reliable. Raw HTML scraping via Firecrawl is the last resort — it's slow, costs credits, and breaks when sites change. Ashby additionally verifies `job count > 0` before accepting the board, because empty Ashby boards return HTTP 200 and would otherwise be a false positive.

**Google Sheets as the live output.** Results stream to the sheet per company rather than being written at the end. This means partial progress survives a crash, and a long run can be watched in real time. The markdown report mode (`--no-sheets`) exists as a fallback for testing without sheet auth.

**Match-score threshold of 60.** Claude scores every job against `criteria.md` and explains its reasoning. Anything below 60 is dropped before writing. The rule is stricter than it sounds because the score reflects real criteria fit, not keyword overlap.

**Sheet as a URL cache.** The Companies tab columns C (Careers URL) and D (ATS Type) are written after the first successful discovery. On subsequent runs, the pipeline reads them back and skips rediscovery — saving API calls and avoiding EXA returning wrong results for companies it's already found. To force a rediscovery for one company, clear column C in the sheet. `--no-sheets` mode and `--company` with a new company both always run discovery.

**`custom_urls.json` as a permanent override.** When a company needs a pinned URL (wrong ATS detected, unusual slug, acquired, JS-rendered), add it here. Unlike the sheet cache, `custom_urls.json` overrides are applied before the cache is even checked — they're permanent, not session-derived. Each entry's `note` explains why it's pinned.

---

## Setup

The `.env` file lives in `files/`:

```
ANTHROPIC_API_KEY=your_key_here
FIRECRAWL_API_KEY=your_key_here          # only for the Firecrawl fallback
EXA_API_KEY=your_key_here                # only for the URL discovery fallback
GOOGLE_SHEET_ID=your_sheet_id_here       # the ID from the Google Sheet URL
GOOGLE_SERVICE_ACCOUNT_PATH=./service_account.json
```

One-time Sheets setup (creates the two tabs with their headers):

```bash
node setupSheets.js
```

**`dotenv` override gotcha.** Claude Code sets `ANTHROPIC_API_KEY` as an empty env var in the parent process. The code calls `dotenv.config({ override: true })` so the real key from `.env` wins. If you see authentication errors, check this first.

---

## Troubleshooting

**"Could not find careers page"** → The company isn't on a known ATS and EXA didn't find a match. Add it to `custom_urls.json` with the correct URL and `atsType`.

**Jobs returned look wrong for a company (wrong ATS, stale URL)** → Clear column C in the Google Sheet for that row and rerun. The pipeline will rediscover the URL fresh.

**"Rate limit hit"** → Bump `DELAY_MS` in `index.js` (currently 2000ms).

**Matching returns nothing despite many jobs** → The matcher only sees the first `MAX_JOBS_TO_SEND_TO_AI` jobs (currently 50, set in `index.js`). For companies with hundreds of listings, the right one may be past the cutoff. Raise the cap or pre-filter upstream.

---

## Do not

- Do not hallucinate job listings. If scraping fails, say so clearly in the output.
- Do not match jobs loosely. If criteria says "Director level", don't return IC roles.
- Do not crash the whole pipeline if one company fails. Log the error and move on.
- Do not run from the parent `job-search/` directory — run from inside `files/`.
