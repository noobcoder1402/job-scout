// index.js — Main orchestrator
// This is the entry point. It reads your companies and criteria,
// then runs each company through the full pipeline in parallel.
//
// Usage:
//   node index.js                  → run all companies from Google Sheet
//   node index.js --rows 2-5       → run only rows 2–5 from the sheet
//   node index.js --company Notion → run one specific company
//   node index.js --errors         → rerun only companies with Status = "Error" (forces rediscovery)
//   node index.js --no-sheets      → skip Sheets, use companies.txt + markdown report
//   node index.js --mock           → use fake job data (for testing)

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

// Load .env from the same directory as this script
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env'), override: true });

import { findCareersUrl, detectAtsFromUrl } from './findCareersUrl.js';
import { scrapeJobs } from './scrapeJobs.js';
import { matchJobs } from './matchJobs.js';
import { generateReport } from './generateReport.js';
import { getMockJobs } from './mockJobs.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_JOBS_TO_SEND_TO_AI = 50; // Don't send 500 jobs to Claude — trim first
const CONCURRENCY = 5;             // Process this many companies at the same time

// ─── Parse CLI flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const USE_MOCK = args.includes('--mock');
const NO_SHEETS = args.includes('--no-sheets');
const ERRORS_ONLY = args.includes('--errors');

// --company "Notion" or --company=Notion
const SINGLE_COMPANY = args.find(a => a.startsWith('--company='))?.split('=')[1]
  || (args.indexOf('--company') !== -1 ? args[args.indexOf('--company') + 1] : null);

// --rows 2-5 or --rows=2-5
const ROWS_ARG = args.find(a => a.startsWith('--rows='))?.split('=')[1]
  || (args.indexOf('--rows') !== -1 ? args[args.indexOf('--rows') + 1] : null);

// ─── Initialize Sheets client ─────────────────────────────────────────────────

let sheetsClient = null;

if (!NO_SHEETS) {
  try {
    sheetsClient = await import('./sheetsClient.js');
    console.log('\n📊 Google Sheets: connected');
  } catch (err) {
    console.warn(`\n⚠️  Could not connect to Google Sheets: ${err.message}`);
    console.warn('   Falling back to companies.txt + markdown report.');
    console.warn('   (You can also run with --no-sheets to silence this warning)\n');
    sheetsClient = null;
  }
}

// ─── Read companies ───────────────────────────────────────────────────────────

console.log('\n🚀 Job Scout starting up...\n');

let companies;
const urlCache = new Map(); // company name → { careersUrl, atsType } from sheet

if (SINGLE_COMPANY) {
  companies = [SINGLE_COMPANY];
  console.log(`🎯 Single company mode: running only for "${SINGLE_COMPANY}"`);

} else if (sheetsClient) {
  console.log('📊 Reading companies from Google Sheet...');
  const companyRows = await sheetsClient.readCompanies({
    rows: ROWS_ARG,
    status: ERRORS_ONLY ? 'Error' : undefined,
  });

  if (companyRows.length === 0) {
    if (ERRORS_ONLY) {
      console.log('✅ No companies with Status = "Error" found — nothing to retry.');
    } else if (ROWS_ARG) {
      console.log(`⚠️  No companies found in rows ${ROWS_ARG} of the Companies tab.`);
    } else {
      console.log('⚠️  No companies found in the Companies tab.');
      console.log('   Add company names in column A and try again.');
      console.log('   (Or run node setupSheets.js if you haven\'t set up the sheet yet)');
    }
    process.exit(0);
  }

  companies = companyRows.map(c => c.name);

  if (ERRORS_ONLY) {
    // Force rediscovery: clear cached URL + ATS type for each error company
    console.log(`   🔄 Clearing cached URLs for ${companies.length} error companies (forcing rediscovery)...`);
    for (const name of companies) {
      await sheetsClient.clearCompanyCache(name);
    }
    console.log(`   ✓ Cache cleared. Will rediscover from scratch.`);
    // Don't populate urlCache — we want fresh discovery for all of these
  } else {
    companyRows.forEach(row => {
      if (row.careersUrl && row.atsType) urlCache.set(row.name, { careersUrl: row.careersUrl, atsType: row.atsType });
    });
  }

  const cachedCount = urlCache.size;
  if (ERRORS_ONLY) {
    console.log(`   Retrying ${companies.length} error companies: ${companies.join(', ')}`);
  } else if (ROWS_ARG) {
    console.log(`   Running rows ${ROWS_ARG}: ${companies.join(', ')}${cachedCount ? ` (${cachedCount} URLs already cached)` : ''}`);
  } else {
    console.log(`   Found ${companies.length} companies: ${companies.join(', ')}${cachedCount ? ` (${cachedCount} URLs already cached)` : ''}`);
  }

} else {
  console.log('📄 Reading companies from companies.txt...');
  const companiesRaw = fs.readFileSync(
    path.resolve(process.cwd(), 'companies.txt'), 'utf-8'
  );
  companies = companiesRaw
    .split('\n')
    .map(c => c.trim())
    .filter(Boolean);
  console.log(`   Found ${companies.length} companies: ${companies.join(', ')}`);
}

// ─── Read criteria ────────────────────────────────────────────────────────────

console.log('\n📋 Reading your job criteria from criteria.md...');
const criteria = fs.readFileSync(
  path.resolve(process.cwd(), 'criteria.md'), 'utf-8'
);
console.log('   Criteria loaded. ✓');

if (USE_MOCK) {
  console.log('\n⚠️  MOCK MODE — using fake job data, no real scraping happening.');
}

// ─── Per-company processor ────────────────────────────────────────────────────

const runDate = new Date().toLocaleDateString('en-GB');

async function processCompany(company) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🏢 Processing: ${company}`);
  console.log(`${'─'.repeat(60)}`);

  const companyResult = {
    company,
    careersUrl: null,
    matches: [],
    error: null,
    noMatchReason: null,
  };

  try {
    // ── Step 1: Find careers URL ─────────────────────────────────────────────
    let careersUrl;
    let atsType;
    let slug;

    if (USE_MOCK) {
      careersUrl = `https://${company.toLowerCase()}.com/careers`;
      atsType = 'mock';
    } else {
      const cached = urlCache.get(company);
      if (cached) {
        careersUrl = cached.careersUrl;
        atsType = cached.atsType;
        slug = detectAtsFromUrl(careersUrl).slug;
        console.log(`\n🔍 Step 1 [${company}]: Using cached URL: ${careersUrl} (type: ${atsType})`);
        console.log(`   ℹ️  To force rediscovery, clear column C for this row in the sheet.`);
      } else {
        console.log(`\n🔍 Step 1 [${company}]: Finding careers page...`);
        const urlResult = await findCareersUrl(company);
        careersUrl = urlResult.url;
        atsType = urlResult.atsType;
        slug = urlResult.slug;
        if (urlResult.note) {
          console.log(`   ℹ️  [${company}] Note: ${urlResult.note}`);
          companyResult.noMatchReason = urlResult.note;
        }
        console.log(`   ✓ [${company}] Found: ${careersUrl || 'N/A'} (type: ${atsType})`);
      }
    }

    companyResult.careersUrl = careersUrl;
    companyResult.atsType = atsType;

    // Write career URL back to sheet immediately (so you can see it in real time)
    if (sheetsClient) {
      try {
        await sheetsClient.updateCompanyUrl(company, { url: careersUrl, atsType });
        console.log(`   📊 [${company}] Sheet updated: careers URL and ATS type saved`);
      } catch (sheetErr) {
        console.warn(`   ⚠️  [${company}] Sheet update failed (continuing): ${sheetErr.message}`);
      }
    }

    // ── Step 2: Scrape job listings ──────────────────────────────────────────
    let rawJobs;

    if (USE_MOCK) {
      console.log(`\n📥 Step 2 [${company}]: Loading mock jobs...`);
      rawJobs = getMockJobs(company);
      console.log(`   ✓ Got ${rawJobs.length} mock job listings`);
    } else {
      console.log(`\n📥 Step 2 [${company}]: Fetching job listings...`);
      rawJobs = await scrapeJobs({ company, careersUrl, atsType, slug });
      console.log(`   ✓ [${company}] Found ${rawJobs.length} total job listings`);
    }

    if (rawJobs.length === 0) {
      console.log(`   ⚠️  No jobs found at ${company}. Skipping.`);
      companyResult.noMatchReason = 'No job listings found on careers page';

      if (sheetsClient) {
        try {
          const status = (atsType === 'acquired' || atsType === 'client-side') ? 'Skipped' : 'No Matches';
          await sheetsClient.updateCompanyStatus(company, {
            status,
            matchCount: 0,
            error: null,
            noMatchReason: companyResult.noMatchReason,
          });
        } catch (sheetErr) {
          console.warn(`   ⚠️  [${company}] Sheet status update failed: ${sheetErr.message}`);
        }
      }
      return companyResult;
    }

    // Trim to avoid sending too many tokens to Claude
    const jobsToEvaluate = rawJobs.slice(0, MAX_JOBS_TO_SEND_TO_AI);
    if (rawJobs.length > MAX_JOBS_TO_SEND_TO_AI) {
      console.log(`   ℹ️  [${company}] Trimmed to ${MAX_JOBS_TO_SEND_TO_AI} jobs for AI evaluation (${rawJobs.length} total found)`);
    }

    // ── Step 3: AI matching ──────────────────────────────────────────────────
    console.log(`\n🤖 Step 3 [${company}]: Asking Claude to find best matches...`);
    const matches = await matchJobs({
      company,
      jobs: jobsToEvaluate,
      criteria,
      careersUrl,
    });

    if (matches.length === 0) {
      console.log(`   ❌ No matching roles found at ${company}`);
      companyResult.noMatchReason = 'No roles matched your criteria';
    } else {
      console.log(`   ✅ [${company}] Found ${matches.length} match(es):`);
      matches.forEach((m, i) => console.log(`      ${i + 1}. ${m.title} (score: ${m.score})`));
    }

    companyResult.matches = matches;

    // Write job matches to sheet (appends — never overwrites your old notes)
    if (sheetsClient) {
      try {
        if (matches.length > 0) {
          await sheetsClient.writeJobMatches(company, matches, runDate);
          console.log(`   📊 [${company}] ${matches.length} match(es) appended to Job Matches tab`);
        }
        await sheetsClient.updateCompanyStatus(company, {
          status: matches.length > 0 ? 'Done' : 'No Matches',
          matchCount: matches.length,
          error: null,
          noMatchReason: matches.length === 0 ? companyResult.noMatchReason : '',
        });
      } catch (sheetErr) {
        console.warn(`   ⚠️  [${company}] Sheet write failed (results still in memory): ${sheetErr.message}`);
      }
    }

  } catch (err) {
    console.error(`   🚨 Error processing ${company}: ${err.message}`);
    companyResult.error = err.message;

    if (sheetsClient) {
      try {
        await sheetsClient.updateCompanyStatus(company, {
          status: 'Error',
          matchCount: 0,
          error: err.message,
          noMatchReason: '',
        });
      } catch (sheetErr) {
        console.warn(`   ⚠️  [${company}] Could not write error to sheet: ${sheetErr.message}`);
      }
    }
  }

  return companyResult;
}

// ─── Worker pool ──────────────────────────────────────────────────────────────
// Spins up CONCURRENCY workers. Each worker grabs the next company, processes it,
// then immediately picks up the next one — no waiting for slower workers.

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

console.log(`\n⚡ Running ${companies.length} ${companies.length === 1 ? 'company' : 'companies'} (up to ${CONCURRENCY} in parallel)...\n`);
const results = await runWithConcurrency(companies, CONCURRENCY, processCompany);

// ── Final output ──────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);

if (sheetsClient) {
  const totalMatches = results.reduce((sum, r) => sum + (r.matches?.length || 0), 0);
  const withMatches = results.filter(r => r.matches?.length > 0).length;
  const errors = results.filter(r => r.error).length;

  console.log(`\n📊 Done! Results are live in your Google Sheet.`);
  console.log(`\n   Summary:`);
  console.log(`   • ${results.length} companies processed`);
  console.log(`   • ${withMatches} companies had matching roles`);
  console.log(`   • ${totalMatches} total job matches written to "Job Matches" tab`);
  if (errors > 0) console.log(`   • ${errors} companies had errors (see column H in Companies tab)`);
  console.log(`\n   Open your sheet and filter the "Job Matches" tab by Run Date = ${runDate} to see today's results.\n`);

} else {
  console.log('📝 Step 4: Writing your results report...');
  const reportPath = await generateReport(results);
  console.log(`\n✅ Done! Report saved to: ${reportPath}`);
  console.log('\nOpen it in any markdown viewer or text editor.\n');
}
