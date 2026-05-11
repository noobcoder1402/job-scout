// sheetsClient.js — Google Sheets read/write wrapper
//
// This file is the only place in the project that "speaks" Google Sheets.
// Everything else just calls these functions with plain JavaScript data
// and this file handles the translation into Sheets API calls.

import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Tab and column config ────────────────────────────────────────────────────

const COMPANIES_TAB = 'Companies';
const MATCHES_TAB = 'Job Matches';

// Headers for each tab — order here defines column order in the sheet
export const COMPANIES_HEADERS = [
  'Company',          // A — you fill this in
  'Status',           // B — pipeline updates this
  'Careers URL',      // C — pipeline fills this
  'ATS Type',         // D — pipeline fills this
  'Matches Found',    // E — pipeline fills this
  'Last Run',         // F — pipeline fills this
  'Notes',            // G — YOUR column, pipeline never touches
  'Error',            // H — pipeline fills on failure
  'No Match Reason',  // I — pipeline explains why no roles were found
];

export const MATCHES_HEADERS = [
  'Company',        // A
  'Job Title',      // B
  'Location',       // C
  'Match Score',    // D
  'Why It Matches', // E
  'Job URL',        // F
  'Run Date',       // G
  'Your Notes',     // H — YOUR column, pipeline never touches
  'Status',         // I — YOUR column (e.g. "Applied", "Declined")
];

// ─── Internal: get authenticated Sheets client ───────────────────────────────

let _sheets = null;
let _spreadsheetId = null;

async function getSheets() {
  if (_sheets) return { sheets: _sheets, spreadsheetId: _spreadsheetId };

  // Find the service account credentials file
  const credPath = path.resolve(
    __dirname,
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service_account.json'
  );

  if (!fs.existsSync(credPath)) {
    throw new Error(
      `Google service account file not found at: ${credPath}\n` +
      `Please complete the one-time setup:\n` +
      `  1. Go to console.cloud.google.com → create project\n` +
      `  2. Enable Google Sheets API\n` +
      `  3. Create a Service Account → download JSON → save as service_account.json in the files/ folder\n` +
      `  4. Share your Google Sheet with the service account email\n` +
      `  5. Add GOOGLE_SHEET_ID to your .env file\n` +
      `  Or run with --no-sheets to skip Sheets integration.`
    );
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error(
      `GOOGLE_SHEET_ID not set in .env file.\n` +
      `Copy the ID from your Google Sheet URL: docs.google.com/spreadsheets/d/THIS_PART/edit\n` +
      `Or run with --no-sheets to skip Sheets integration.`
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheets = google.sheets({ version: 'v4', auth });
  _spreadsheetId = spreadsheetId;

  return { sheets: _sheets, spreadsheetId: _spreadsheetId };
}

// ─── Internal: find the row number for a company name ────────────────────────
// Returns the 1-indexed row number in the sheet, or null if not found.
// (Row 1 = header, Row 2 = first company, etc.)

async function findCompanyRow(name) {
  const { sheets, spreadsheetId } = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${COMPANIES_TAB}!A:A`,
  });

  const values = response.data.values || [];
  for (let i = 1; i < values.length; i++) { // Start at 1 to skip header row
    const cellValue = values[i]?.[0]?.trim();
    if (cellValue && cellValue.toLowerCase() === name.trim().toLowerCase()) {
      return i + 1; // Convert 0-indexed array position to 1-indexed sheet row
    }
  }
  return null;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Read the list of companies from the Companies tab.
 *
 * Options:
 *   rows: "2-5"         — only return companies in sheet rows 2 through 5
 *   companies: [...]    — only return these specific company names
 *
 * Returns: array of { name, rowIndex } objects
 */
export async function readCompanies({ rows, companies, status } = {}) {
  const { sheets, spreadsheetId } = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${COMPANIES_TAB}!A:D`,
  });

  const values = response.data.values || [];
  const result = [];

  for (let i = 1; i < values.length; i++) { // Skip header (i=0 = row 1)
    const name = values[i]?.[0]?.trim();
    if (!name) continue;
    const rowIndex = i + 1; // 1-indexed sheet row number
    result.push({
      name,
      rowIndex,
      status: values[i]?.[1]?.trim() || null,      // column B
      careersUrl: values[i]?.[2]?.trim() || null,  // column C
      atsType: values[i]?.[3]?.trim() || null,      // column D
    });
  }

  // Filter by status if specified (e.g. "--errors" → status = 'Error')
  if (status) {
    const normalized = status.trim().toLowerCase();
    return result.filter(c => c.status?.toLowerCase() === normalized);
  }

  // Filter by row range if specified (e.g. "--rows 2-5")
  if (rows) {
    const parts = rows.split('-').map(Number);
    const start = parts[0];
    const end = parts[1] || parts[0]; // Support single row too: "--rows 3"
    return result.filter(c => c.rowIndex >= start && c.rowIndex <= end);
  }

  // Filter by specific company names if specified (e.g. "--company Notion")
  if (companies && companies.length > 0) {
    const normalized = companies.map(c => c.trim().toLowerCase());
    return result.filter(c => normalized.includes(c.name.toLowerCase()));
  }

  return result;
}

/**
 * Called immediately after findCareersUrl() returns.
 * Updates the Companies tab with the discovered URL and ATS type.
 * Also sets Status to "Running" so you can see the pipeline is working.
 */
export async function updateCompanyUrl(name, { url, atsType }) {
  const rowIndex = await findCompanyRow(name);
  if (!rowIndex) {
    console.warn(`   ⚠️  "${name}" not found in the Companies tab — skipping sheet update.`);
    return;
  }

  const { sheets, spreadsheetId } = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${COMPANIES_TAB}!B${rowIndex}`, values: [['Running']] },    // Status
        { range: `${COMPANIES_TAB}!C${rowIndex}`, values: [[url || '']] },    // Careers URL
        { range: `${COMPANIES_TAB}!D${rowIndex}`, values: [[atsType || '']] }, // ATS Type
      ],
    },
  });
}

/**
 * Clears the cached careers URL and ATS type for a company (columns C and D).
 * Used by --errors mode to force fresh rediscovery instead of reusing a bad URL.
 */
export async function clearCompanyCache(name) {
  const rowIndex = await findCompanyRow(name);
  if (!rowIndex) return;

  const { sheets, spreadsheetId } = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${COMPANIES_TAB}!C${rowIndex}`, values: [['']] }, // Careers URL
        { range: `${COMPANIES_TAB}!D${rowIndex}`, values: [['']] }, // ATS Type
      ],
    },
  });
}

/**
 * Called after each company finishes (success, no match, or error).
 * Updates Status, Matches Found, Last Run, and Error columns.
 * Never touches column G (Notes) — that's yours.
 */
export async function updateCompanyStatus(name, { status, matchCount, error, noMatchReason }) {
  const rowIndex = await findCompanyRow(name);
  if (!rowIndex) {
    console.warn(`   ⚠️  "${name}" not found in the Companies tab — skipping status update.`);
    return;
  }

  const { sheets, spreadsheetId } = await getSheets();
  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${COMPANIES_TAB}!B${rowIndex}`, values: [[status || 'Done']] },
        { range: `${COMPANIES_TAB}!E${rowIndex}`, values: [[matchCount ?? '']] },
        { range: `${COMPANIES_TAB}!F${rowIndex}`, values: [[now]] },
        { range: `${COMPANIES_TAB}!H${rowIndex}`, values: [[error || '']] },
        { range: `${COMPANIES_TAB}!I${rowIndex}`, values: [[noMatchReason || '']] },
      ],
    },
  });
}

/**
 * Called after AI matching completes.
 * Appends one row per match to the Job Matches tab.
 * Old matches are never deleted — filter by Run Date (column G) to see latest results.
 * Columns H and I are left blank — those are your notes/status columns.
 */
export async function writeJobMatches(name, matches, runDate) {
  if (!matches || matches.length === 0) return;

  const { sheets, spreadsheetId } = await getSheets();
  const date = runDate || new Date().toLocaleDateString('en-GB');

  const rows = matches.map(m => [
    name,                 // A: Company
    m.title || '',        // B: Job Title
    m.location || '',     // C: Location
    m.score || '',        // D: Match Score
    m.matchReason || '',  // E: Why It Matches
    m.url || '',          // F: Job URL
    date,                 // G: Run Date
    '',                   // H: Your Notes — user fills this
    '',                   // I: Status — user fills this
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${MATCHES_TAB}!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/**
 * One-time setup: ensures both tabs exist with the correct headers.
 * Called by setupSheets.js — you don't need to run this manually.
 * Returns info about what was created.
 */
export async function initializeSheet() {
  const { sheets, spreadsheetId } = await getSheets();

  // Get list of existing sheet tabs
  const metaResponse = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = metaResponse.data.sheets.map(s => s.properties.title);

  console.log(`   Existing tabs: ${existingTabs.join(', ') || '(none)'}`);

  // Create any missing tabs
  const tabsToCreate = [];
  if (!existingTabs.includes(COMPANIES_TAB)) tabsToCreate.push(COMPANIES_TAB);
  if (!existingTabs.includes(MATCHES_TAB)) tabsToCreate.push(MATCHES_TAB);

  if (tabsToCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: tabsToCreate.map(title => ({
          addSheet: { properties: { title } },
        })),
      },
    });
    console.log(`   Created tabs: ${tabsToCreate.join(', ')}`);
  } else {
    console.log(`   Both tabs already exist — just updating headers.`);
  }

  // Write (or refresh) headers on both tabs
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${COMPANIES_TAB}!A1:I1`, values: [COMPANIES_HEADERS] },
        { range: `${MATCHES_TAB}!A1:I1`, values: [MATCHES_HEADERS] },
      ],
    },
  });

  return { created: tabsToCreate, alreadyExisted: existingTabs };
}
