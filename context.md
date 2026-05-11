# Job Scout — Project Context

_Snapshot of current state. Updated after every session with code changes. Written for the next Claude session, not as a changelog._

---

## Current Status

✅ Full pipeline working end-to-end (Sheets → scrape → match → write back).
✅ Google Sheets two-way integration complete.
✅ EXA fallback working for unknown companies.
✅ `custom_urls.json` has 16 company overrides to bypass broken ATS detection.
✅ Public GitHub repo live at https://github.com/noobcoder1402/job-scout.
⚠️ 11 companies permanently "Skipped" — use Workday/SmartRecruiters/custom JS pages that can't be scraped. Manual checks required (see table below).

---

## Last Run

_Update this after each run._

| Field | Value |
|---|---|
| Date | 2026-03-19 |
| Companies run | unknown — update after next run |
| Matches found | unknown — update after next run |
| Notes | First full run after Sheets integration. Hasura had a bad URL (now fixed in custom_urls.json). |

---

## Key Config Values

These live in `index.js` — listed here so the next session doesn't need to hunt:

| Setting | Value | What it does |
|---|---|---|
| `MAX_JOBS_TO_SEND_TO_AI` | 50 | Cap on jobs sent to Claude per company |
| `DELAY_MS` | 2000ms | Pause between companies to avoid rate limits |
| Match score threshold | 60 | Jobs below this are dropped before writing to Sheets |

---

## Next Session Notes

- The Hasura bogus rows (Supabase jobs mislabeled as Hasura) from the first run may still need manual cleanup in the "Job Matches" tab. Look for rows where Company = "Hasura" but job URLs link to `jobs.ashbyhq.com/supabase/...` — delete those rows.
- Consider raising `MAX_JOBS_TO_SEND_TO_AI` above 50 for companies with large boards (e.g. Salesforce, HubSpot) if matches feel thin.
- GitHub repo is public. `criteria.md` is git-ignored — any future changes to it stay local. If you update code, remember to push: `git add . && git commit -m "description" && git push`.

---

## Known Issues / Limitations

- Re-running a company appends new rows — old rows are never deleted. Filter the "Job Matches" tab by Run Date (column H) to see only the latest results.
- **Snyk** — Pipeline detects Greenhouse correctly but the API occasionally returns 404. If Snyk shows as "Error", rerun: `node index.js --company Snyk`
- Companies not found in the Companies tab log a warning but won't crash the pipeline.
- `--no-sheets` mode always runs full discovery (no URL cache from the sheet).

---

## Companies That Need Manual Checking

These can't be auto-scraped. Visit their career pages directly:

| Company | URL | Reason |
|---|---|---|
| Chargebee | jobs.chargebee.com | Custom subdomain |
| Freshdesk | careers.smartrecruiters.com/freshworks | SmartRecruiters |
| Jotform | jotform.com/jobs/ | JavaScript-rendered |
| BrowserStack | browserstack.wd3.myworkdayjobs.com/External | Workday |
| Zoho | careers.zohocorp.com/jobs/careers | ZohoRecruit |
| SailPoint | sailpoint.wd1.myworkdayjobs.com/SailPoint | Workday |
| DocuSign | careers.docusign.com | Custom careers site |
| InVideo | invideo.io/careers | JavaScript-rendered |
| Shopify | shopify.com/careers | Custom portal |
| Hasura | hasura.io/careers/ | Custom page |
| Retool | retool.com/careers | JavaScript-rendered |
