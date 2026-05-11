// findCareersUrl.js — Step 1
// Figures out WHERE a company posts their jobs.
// Strategy: check known ATS platforms first (fast + reliable),
// then fall back to a web search if none match.

import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Known ATS slug patterns — most B2B SaaS companies use one of these
const ATS_CHECKERS = [
  {
    name: 'greenhouse',
    // Greenhouse API: returns JSON of all jobs if the board exists
    buildUrl: (slug) => `https://api.greenhouse.io/v1/boards/${slug}/jobs`,
    buildCareersUrl: (slug) => `https://boards.greenhouse.io/${slug}`,
    // Greenhouse slugs are usually lowercase company name with no spaces
    buildSlug: (company) => company.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, ''),
  },
  {
    name: 'lever',
    // Lever API: returns JSON array of postings
    buildUrl: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json&limit=250`,
    buildCareersUrl: (slug) => `https://jobs.lever.co/${slug}`,
    buildSlug: (company) => company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  },
  {
    name: 'ashby',
    // Ashby: check if the careers page loads
    buildUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    buildCareersUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    buildSlug: (company) => company.toLowerCase().replace(/\s+/g, ''),
  },
];

// Some companies we know use non-standard URLs — add overrides here
// Format: "CompanyName": { url: "...", atsType: "..." }
let CUSTOM_URL_OVERRIDES = {};
try {
  const raw = readFileSync(path.join(__dirname, 'custom_urls.json'), 'utf-8');
  CUSTOM_URL_OVERRIDES = JSON.parse(raw);
} catch {
  // File doesn't exist yet — that's fine
}

/**
 * Main function: finds the careers URL for a given company name.
 * Returns: { url: string, atsType: 'greenhouse' | 'lever' | 'ashby' | 'custom' | 'unknown' }
 */
export async function findCareersUrl(company) {
  // Check manual overrides first
  if (CUSTOM_URL_OVERRIDES[company]) {
    console.log(`   Using manual override for ${company}`);
    return CUSTOM_URL_OVERRIDES[company];
  }

  // Try each ATS in order
  for (const ats of ATS_CHECKERS) {
    const slug = ats.buildSlug(company);
    const apiUrl = ats.buildUrl(slug);

    console.log(`   Trying ${ats.name} with slug "${slug}"...`);

    try {
      const res = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (res.ok) {
        // For Greenhouse, verify it actually has jobs (not just a 200 on empty board)
        if (ats.name === 'greenhouse') {
          const data = await res.json();
          if (data.jobs && data.jobs.length >= 0) {
            // Valid board exists (even if 0 jobs)
            console.log(`   ✓ ${company} is on Greenhouse`);
            return {
              url: ats.buildCareersUrl(slug),
              atsType: 'greenhouse',
              slug,
            };
          }
        } else if (ats.name === 'lever') {
          const data = await res.json();
          if (Array.isArray(data)) {
            console.log(`   ✓ ${company} is on Lever`);
            return {
              url: ats.buildCareersUrl(slug),
              atsType: 'lever',
              slug,
            };
          }
        } else if (ats.name === 'ashby') {
          // Verify the Ashby page actually has jobs, not just a 200 response.
          // Empty boards return 200 too, which would cause a false positive.
          const pageHtml = await res.text();
          const idx = pageHtml.indexOf('window.__appData');
          if (idx !== -1) {
            const chunk = pageHtml.slice(pageHtml.indexOf('=', idx) + 1).trimStart();
            let depth = 0, end = 0, inStr = false, esc = false;
            for (let i = 0; i < chunk.length; i++) {
              const c = chunk[i];
              if (esc) { esc = false; continue; }
              if (c === '\\' && inStr) { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (!inStr) {
                if (c === '{') depth++;
                else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
              }
            }
            try {
              const data = JSON.parse(chunk.slice(0, end));
              const count = data?.jobBoard?.jobPostings?.length ?? 0;
              if (count > 0) {
                console.log(`   ✓ ${company} is on Ashby (${count} jobs)`);
                return { url: ats.buildCareersUrl(slug), atsType: 'ashby', slug };
              } else {
                console.log(`   ✗ ${ats.name} board exists but has 0 jobs — skipping`);
              }
            } catch {
              console.log(`   ✗ ${ats.name} board exists but couldn't parse data`);
            }
          }
        }
      }
    } catch (err) {
      // Network error, timeout, etc. — just try the next ATS
      console.log(`   ✗ ${ats.name} failed: ${err.message}`);
    }
  }

  // If no ATS matched, fall back to Exa search
  console.log(`   No ATS matched. Trying web search for ${company} careers page...`);
  return await findViaWebSearch(company);
}

/**
 * Given a URL found via web search, detect if it belongs to a known ATS
 * and return the correct atsType + slug so the right scraper is used.
 * Without this, every EXA result would be treated as "custom" and need Firecrawl.
 */
export function detectAtsFromUrl(url) {
  try {
    const u = new URL(url);
    const hostname = u.hostname; // e.g. "boards.greenhouse.io"
    const pathParts = u.pathname.split('/').filter(Boolean); // e.g. ["gitlab"]

    if (hostname.includes('greenhouse.io')) {
      const slug = pathParts[0] || null;
      return { atsType: 'greenhouse', slug };
    }
    if (hostname.includes('lever.co')) {
      const slug = pathParts[0] || null;
      return { atsType: 'lever', slug };
    }
    if (hostname.includes('ashbyhq.com')) {
      const slug = pathParts[0] || null;
      return { atsType: 'ashby', slug };
    }
    if (hostname.includes('myworkdayjobs.com')) {
      return { atsType: 'workday', slug: null };
    }
  } catch {
    // Malformed URL — fall through to custom
  }
  return { atsType: 'custom', slug: null };
}

/**
 * Fallback: use Exa API to find the careers URL via web search.
 * Requires EXA_API_KEY in .env
 */
async function findViaWebSearch(company) {
  const EXA_API_KEY = process.env.EXA_API_KEY;

  if (!EXA_API_KEY) {
    console.log('   ⚠️  No EXA_API_KEY set — cannot do web search fallback.');
    return { url: null, atsType: 'unknown', slug: null };
  }

  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
      },
      body: JSON.stringify({
        query: `${company} careers jobs hiring site`,
        numResults: 3,
        includeDomains: ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com'],
      }),
    });

    if (!res.ok) throw new Error(`Exa API error: ${res.status}`);

    const data = await res.json();
    const firstResult = data.results?.[0];

    if (firstResult?.url) {
      console.log(`   ✓ Found via web search: ${firstResult.url}`);
      // If the URL is a known ATS, extract the slug and set the correct type
      // so the right scraper gets used instead of falling back to Firecrawl
      const detected = detectAtsFromUrl(firstResult.url);
      return {
        url: firstResult.url,
        atsType: detected.atsType,
        slug: detected.slug,
      };
    }
  } catch (err) {
    console.log(`   ✗ Web search failed: ${err.message}`);
  }

  // Complete fallback: guess a common pattern
  const guessedUrl = `https://www.${company.toLowerCase().replace(/\s+/g, '')}.com/careers`;
  console.log(`   ⚠️  Guessing URL: ${guessedUrl}`);
  return { url: guessedUrl, atsType: 'custom', slug: null };
}
