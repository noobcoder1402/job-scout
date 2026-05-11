// matchJobs.js — Step 3
// The heart of the project.
// Sends the job listings + your criteria to Claude and asks it to pick the best matches.
// Returns up to 3 matches with title, URL, and a clear reason why it matches.

import Anthropic from '@anthropic-ai/sdk';

/**
 * Main function: AI-powered job matching.
 *
 * @param {string} company - Company name (for context)
 * @param {Array} jobs - Array of job objects from scrapeJobs.js
 * @param {string} criteria - Full text of criteria.md
 * @param {string} careersUrl - Link to the careers page (for constructing job URLs)
 * @returns {Array} - Up to 3 matched jobs: { title, url, location, matchReason, score }
 */
export async function matchJobs({ company, jobs, criteria, careersUrl }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  if (!jobs || jobs.length === 0) return [];

  // Build a clean job list to send to Claude
  // We format it as a numbered list so Claude can reference jobs easily
  const jobListText = jobs.map((job, i) => {
    return [
      `[${i + 1}] ${job.title}`,
      `    Location: ${job.location || 'Not specified'}`,
      `    Department: ${job.department || 'Not specified'}`,
      `    URL: ${job.url || careersUrl}`,
      job.description ? `    Description: ${job.description.slice(0, 400)}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  // The message is split into two content blocks:
  // Block 1 (cached): the system instructions + criteria — identical for every company in a run.
  //   After the first call, Anthropic serves this from cache at ~10% of the normal token cost.
  // Block 2 (not cached): the job listings for this specific company — changes every call.
  const criteriaBlock = {
    type: 'text',
    text: `You are a job matching assistant. Your job is to find the best matches between a job seeker's criteria and a list of open roles at a company.

## The Job Seeker's Criteria

${criteria}`,
    cache_control: { type: 'ephemeral' },
  };

  const jobsBlock = {
    type: 'text',
    text: `## Open Roles at ${company}

${jobListText}

## Your Task

Review all ${jobs.length} roles above against the criteria. Return ONLY a JSON object with no other text, markdown, or explanation.

The JSON should have this exact structure:
{
  "matches": [
    {
      "title": "exact job title from the list",
      "url": "exact URL from the list",
      "location": "location from the listing",
      "matchReason": "1-2 sentences explaining specifically why this role matches the criteria",
      "score": 85
    }
  ],
  "noMatchReason": null
}

Rules:
- Include UP TO 3 matches, sorted by best match first
- Only include roles that genuinely match the criteria — don't stretch it
- If ZERO roles match, return: { "matches": [], "noMatchReason": "brief explanation of why nothing matched" }
- Score is 0–100 indicating how well it matches (only include roles scoring 60+)
- matchReason must reference SPECIFIC things from the criteria (e.g. "Director level GTM role, remote-friendly, B2B SaaS")
- Do not include junior roles, sales IC roles, or roles that violate the hard-no criteria
- Preserve exact URLs from the listings`,
  };

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: [criteriaBlock, jobsBlock] }],
    });

    const responseText = message.content[0].text.trim();
    const clean = responseText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!parsed.matches || !Array.isArray(parsed.matches)) {
      console.log('   ⚠️  Unexpected response format from matcher. Returning empty.');
      return [];
    }

    return parsed.matches.slice(0, 3); // Safety cap

  } catch (err) {
    console.error(`   🚨 Matching failed for ${company}: ${err.message}`);
    return [];
  }
}
