// scrapeJobs.js — Step 2
// Fetches the actual job listings from a company's careers page.
// Uses the ATS API directly when possible (clean, structured data).
// Falls back to Firecrawl for custom career pages.

import fetch from 'node-fetch';

/**
 * Main function: fetch job listings for a company.
 * Returns array of job objects: { title, url, location, department, description }
 */
export async function scrapeJobs({ company, careersUrl, atsType, slug }) {
  switch (atsType) {
    case 'greenhouse':
      return await scrapeGreenhouse(company, slug);
    case 'lever':
      return await scrapeLever(company, slug);
    case 'ashby':
      return await scrapeAshby(company, careersUrl);
    case 'nextjs':
      return await scrapeNextJs(company, careersUrl);
    case 'gatsby':
      return await scrapeGatsby(company, careersUrl);
    case 'workday':
      return await scrapeWorkday(company, careersUrl);
    case 'acquired':
    case 'client-side':
      return []; // Handled upstream — will show as "no listings"
    case 'custom':
    default:
      return await scrapeViaFirecrawl(company, careersUrl);
  }
}

// ─── Greenhouse ───────────────────────────────────────────────────────────────
// Greenhouse has a public API that returns all jobs in clean JSON.
// No auth needed. Very reliable.

async function scrapeGreenhouse(company, slug) {
  const url = `https://api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  console.log(`   Fetching from Greenhouse API: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)' },
  });

  if (!res.ok) throw new Error(`Greenhouse API returned ${res.status}`);

  const data = await res.json();

  return (data.jobs || []).map(job => ({
    title: job.title,
    url: job.absolute_url,
    location: job.location?.name || 'Not specified',
    department: job.departments?.[0]?.name || 'Not specified',
    // Greenhouse returns full HTML content — strip tags for cleaner AI input
    description: stripHtml(job.content || '').slice(0, 1000),
  }));
}

// ─── Lever ────────────────────────────────────────────────────────────────────
// Lever also has a clean public JSON API. Very easy.

async function scrapeLever(company, slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json&limit=250`;
  console.log(`   Fetching from Lever API: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)' },
  });

  if (!res.ok) throw new Error(`Lever API returned ${res.status}`);

  const data = await res.json();

  return (Array.isArray(data) ? data : []).map(job => ({
    title: job.text,
    url: job.hostedUrl,
    location: job.categories?.location || 'Not specified',
    department: job.categories?.department || 'Not specified',
    // Lever returns lists of content blocks — join them
    description: (job.descriptionPlain || job.description || '').slice(0, 1000),
  }));
}

// ─── Ashby ────────────────────────────────────────────────────────────────────
// Ashby embeds all job data in window.__appData in the page HTML.
// We fetch the plain HTML and extract the JSON — no Firecrawl or API key needed.

async function scrapeAshby(company, careersUrl) {
  console.log(`   Fetching Ashby page HTML for ${careersUrl}...`);

  const res = await fetch(careersUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!res.ok) throw new Error(`Ashby page returned ${res.status}`);

  const html = await res.text();

  // Ashby injects all job data into window.__appData in a <script> tag
  const idx = html.indexOf('window.__appData');
  if (idx === -1) throw new Error('Could not find window.__appData in Ashby page');

  // Robustly extract the JSON object by tracking brace depth
  const chunk = html.slice(html.indexOf('=', idx) + 1).trimStart();
  let depth = 0, end = 0, inStr = false, escape = false;
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
  }

  const data = JSON.parse(chunk.slice(0, end));
  const postings = data?.jobBoard?.jobPostings || [];

  console.log(`   ✓ Extracted ${postings.length} jobs from Ashby page data`);

  return postings.map(job => ({
    title: job.title,
    url: job.externalLink || `${careersUrl}/${job.id}`,
    location: job.workplaceType === 'Remote' ? 'Remote' : (job.locationName || 'Not specified'),
    department: job.departmentName || job.teamName || 'Not specified',
    description: stripHtml(job.descriptionHtml || job.descriptionSafeHtml || '').slice(0, 1000),
  }));
}

// ─── Next.js custom careers pages ────────────────────────────────────────────
// Some companies (like Rippling) host their own careers page built with Next.js.
// Next.js bakes all page data into a <script id="__NEXT_DATA__"> tag in the HTML,
// which we can parse without needing JavaScript to run.

async function scrapeNextJs(company, careersUrl) {
  console.log(`   Fetching Next.js careers page for ${company}...`);

  const res = await fetch(careersUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
  });

  if (!res.ok) throw new Error(`Page returned ${res.status}`);

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No __NEXT_DATA__ found on page');

  const data = JSON.parse(match[1]);
  const pageProps = data?.props?.pageProps || {};

  // Rippling stores jobs at pageProps.jobs.items
  const jobs = pageProps?.jobs?.items || [];

  console.log(`   ✓ Extracted ${jobs.length} jobs from Next.js page data`);

  return jobs.map(job => ({
    title: job.name || job.title,
    url: job.url || careersUrl,
    location: Array.isArray(job.locations)
      ? job.locations.map(l => l.name || l).join(', ') || 'Not specified'
      : (job.location || 'Not specified'),
    department: job.department || 'Not specified',
    description: job.description || '',
  }));
}

// ─── Gatsby custom careers pages ─────────────────────────────────────────────
// Some companies (like Hex) host their careers on Gatsby sites that render job
// listings as anchor links in the HTML — no API or JS rendering needed.

async function scrapeGatsby(company, careersUrl) {
  console.log(`   Fetching Gatsby careers page for ${company}...`);

  const res = await fetch(careersUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
  });

  if (!res.ok) throw new Error(`Page returned ${res.status}`);

  const html = await res.text();
  const baseUrl = new URL(careersUrl).origin;

  // Hex's Gatsby page: each job is an <a href="/careers/slug/"> containing nested <p> tags
  // Structure: <a href="/careers/slug/"><div>...<p>Job Title</p><p>Location</p>...</div></a>
  // We find all <a> tags linking to /careers/* then extract the first <p> inside them as the title.
  const linkPattern = /<a[^>]+href=["'](\/careers\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const jobs = [];
  let m;

  while ((m = linkPattern.exec(html)) !== null) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);

    const innerHtml = m[2];
    // Extract the first <p>...</p> content — this is the job title in Hex's structure
    const pMatch = innerHtml.match(/<p[^>]*>([^<]{3,120})<\/p>/);
    if (!pMatch) continue;

    const title = pMatch[1].trim();
    if (title.length < 3) continue;

    // The second <p> is usually location
    const pMatches = [...innerHtml.matchAll(/<p[^>]*>([^<]{2,80})<\/p>/g)];
    const location = pMatches[1]?.[1]?.trim() || 'Not specified';

    jobs.push({
      title,
      url: `${baseUrl}${path}`,
      location,
      department: 'Not specified',
      description: '',
    });
  }

  console.log(`   ✓ Extracted ${jobs.length} jobs from Gatsby page links`);
  return jobs;
}

// ─── Workday ──────────────────────────────────────────────────────────────────
// Workday has an undocumented but stable REST API used by the public job board.
// Each company has its own subdomain + job board name, both embedded in the URL.
// e.g. https://sailpoint.wd1.myworkdayjobs.com/SailPoint
//         ↑ tenant                        wd instance ↑  ↑ job board name

async function scrapeWorkday(company, careersUrl) {
  const u = new URL(careersUrl);
  // Extract tenant from subdomain: "sailpoint.wd1.myworkdayjobs.com" → "sailpoint"
  const tenant = u.hostname.split('.')[0];
  // Extract job board from path: "/SailPoint" → "SailPoint"
  const jobBoard = u.pathname.replace(/^\//, '').split('/')[0];

  if (!tenant || !jobBoard) {
    throw new Error(`Could not parse Workday tenant/jobBoard from URL: ${careersUrl}`);
  }

  const apiBase = `${u.protocol}//${u.hostname}/wday/cxs/${tenant}/${jobBoard}/jobs`;
  console.log(`   Fetching from Workday API: ${apiBase}`);

  const jobs = [];
  const PAGE_SIZE = 20;
  let offset = 0;
  let total = Infinity;

  while (jobs.length < total && jobs.length < 100) {
    const res = await fetch(apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText: '' }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`Workday API returned ${res.status}`);

    const data = await res.json();
    if (total === Infinity) total = data.total ?? 0;

    const postings = data.jobPostings ?? [];
    if (postings.length === 0) break;

    for (const job of postings) {
      jobs.push({
        title: job.title,
        url: `${u.protocol}//${u.hostname}${job.externalPath}`,
        location: job.locationsText || 'Not specified',
        department: 'Not specified',
        description: '',
      });
    }

    offset += postings.length;
  }

  console.log(`   ✓ Fetched ${jobs.length} jobs from Workday (${total} total)`);
  return jobs;
}

// ─── Firecrawl fallback ───────────────────────────────────────────────────────
// For custom career pages or JS-heavy sites.
// Firecrawl renders the page (including JS) and returns clean markdown.
// Then we use Claude to extract structured job listings from the markdown.

async function scrapeViaFirecrawl(company, careersUrl) {
  const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

  if (!FIRECRAWL_API_KEY) {
    throw new Error('FIRECRAWL_API_KEY not set — cannot scrape custom career pages');
  }

  if (!careersUrl) {
    throw new Error('No careers URL found for this company');
  }

  console.log(`   Scraping via Firecrawl: ${careersUrl}`);

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url: careersUrl,
      formats: ['markdown'],
      waitFor: 2000, // Wait 2s for JS to render
    }),
  });

  if (!res.ok) throw new Error(`Firecrawl returned ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const pageContent = data.data?.markdown || '';

  if (!pageContent) {
    throw new Error('Firecrawl returned empty content');
  }

  console.log(`   ✓ Got page content (${pageContent.length} chars). Extracting job listings...`);

  // Use Claude to parse the unstructured markdown into structured job objects
  return await extractJobsFromMarkdown(company, careersUrl, pageContent);
}

/**
 * Uses Claude API to extract structured job listings from raw page markdown.
 * This handles the case where we scraped a custom careers page and got messy text.
 */
async function extractJobsFromMarkdown(company, careersUrl, markdown) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Here is the raw text content scraped from ${company}'s careers page (${careersUrl}).

Extract all job listings you can find. Return ONLY a JSON array with no other text.

Each item in the array should have:
- title: job title
- url: full URL to the job posting (construct from ${careersUrl} if partial links are found)
- location: location or "Remote" or "Not specified"
- department: team/department or "Not specified"
- description: a short 1-2 sentence summary of the role (if available)

If you cannot find any job listings, return an empty array [].

Page content:
${markdown.slice(0, 8000)}`,
      },
    ],
  });

  try {
    const text = message.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    console.log('   ⚠️  Could not parse Claude\'s job extraction response. Returning empty.');
    return [];
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
