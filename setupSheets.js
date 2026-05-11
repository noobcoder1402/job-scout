// setupSheets.js — One-time setup script
//
// Run this ONCE to create the "Companies" and "Job Matches" tabs
// in your Google Sheet with the correct column headers.
//
// Usage: node setupSheets.js
//
// After this runs, open your Google Sheet and add company names
// in column A of the Companies tab. Then run: node index.js

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env'), override: true });

import { initializeSheet, COMPANIES_HEADERS, MATCHES_HEADERS } from './sheetsClient.js';

console.log('\n🔧 Job Scout — Google Sheets Setup\n');
console.log('This will create the Companies and Job Matches tabs');
console.log('in your Google Sheet with the correct headers.\n');

const sheetId = process.env.GOOGLE_SHEET_ID;
if (!sheetId) {
  console.error('❌ GOOGLE_SHEET_ID is not set in your .env file.');
  console.error('   Add this line to your .env file:');
  console.error('   GOOGLE_SHEET_ID=your_sheet_id_from_url\n');
  console.error('   The Sheet ID is the long string in your Google Sheet URL:');
  console.error('   docs.google.com/spreadsheets/d/THIS_PART_HERE/edit\n');
  process.exit(1);
}

try {
  console.log('🔌 Connecting to Google Sheets...');
  const result = await initializeSheet();

  console.log('\n✅ Setup complete!\n');

  console.log('📋 Companies tab columns:');
  COMPANIES_HEADERS.forEach((h, i) => {
    const col = String.fromCharCode(65 + i); // A, B, C...
    const writer = ['A', 'G'].includes(col) ? '← YOU fill this' : '← Pipeline fills this';
    console.log(`   ${col}: ${h}  ${writer}`);
  });

  console.log('\n📋 Job Matches tab columns:');
  MATCHES_HEADERS.forEach((h, i) => {
    const col = String.fromCharCode(65 + i);
    const writer = ['H', 'I'].includes(col) ? '← YOUR notes column' : '← Pipeline fills this';
    console.log(`   ${col}: ${h}  ${writer}`);
  });

  console.log('\n─────────────────────────────────────────────────\n');
  console.log('🎯 What to do next:\n');
  console.log('   1. Open your Google Sheet');
  console.log('   2. Click on the "Companies" tab');
  console.log('   3. Add company names in column A (one per row, starting at row 2)');
  console.log('   4. Run the pipeline: node index.js\n');
  console.log('🚀 Commands you can use:\n');
  console.log('   node index.js                  → run all companies');
  console.log('   node index.js --rows 2-5       → run only rows 2 through 5');
  console.log('   node index.js --company Notion → run one specific company');
  console.log('   node index.js --no-sheets      → skip Sheets, use companies.txt\n');

} catch (err) {
  console.error('\n❌ Setup failed:', err.message);
  console.error('\nCommon fixes:');
  console.error('  • Make sure service_account.json is in the files/ folder');
  console.error('  • Make sure you shared your Google Sheet with the service account email');
  console.error('  • Make sure GOOGLE_SHEET_ID is correct in .env');
  process.exit(1);
}
