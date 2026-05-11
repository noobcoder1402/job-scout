// mockJobs.js — Mock data for testing
// Use this to test the matching logic without hitting real APIs.
// Run with: node src/index.js --mock

export function getMockJobs(company) {
  const allMocks = {
    Notion: [
      {
        title: 'Head of GTM, Enterprise',
        url: 'https://notion.so/careers/head-gtm-enterprise',
        location: 'Remote',
        department: 'Sales & Marketing',
        description: 'Own the go-to-market strategy for Notions enterprise segment. Define ICP, pricing, and packaging. Work cross-functionally with product and sales.',
      },
      {
        title: 'Senior Account Executive, Mid-Market',
        url: 'https://notion.so/careers/ae-midmarket',
        location: 'New York, NY',
        department: 'Sales',
        description: 'Close new business in the mid-market segment. Manage a quota of $1.2M ARR.',
      },
      {
        title: 'Product Marketing Manager',
        url: 'https://notion.so/careers/pmm',
        location: 'Remote',
        department: 'Marketing',
        description: 'Drive positioning, messaging, and launch strategy for new product features. Partner with product and design.',
      },
      {
        title: 'Growth Marketing Manager',
        url: 'https://notion.so/careers/growth-marketing',
        location: 'San Francisco, CA',
        department: 'Marketing',
        description: 'Run paid acquisition campaigns across Google, LinkedIn, and Meta. Own performance marketing budget.',
      },
    ],
    Linear: [
      {
        title: 'VP of Marketing',
        url: 'https://linear.app/careers/vp-marketing',
        location: 'Remote',
        department: 'Marketing',
        description: 'Lead all marketing functions at Linear. Own brand, content, growth, and demand gen. Report to CEO.',
      },
      {
        title: 'SDR Manager',
        url: 'https://linear.app/careers/sdr-manager',
        location: 'Remote',
        department: 'Sales',
        description: 'Build and manage a team of 6 SDRs. Own top-of-funnel pipeline generation.',
      },
      {
        title: 'Engineer, Frontend',
        url: 'https://linear.app/careers/frontend-engineer',
        location: 'Remote',
        department: 'Engineering',
        description: 'Build the Linear web app. Work with React, TypeScript, and our custom rendering engine.',
      },
    ],
    Rippling: [
      {
        title: 'Director, Revenue Operations',
        url: 'https://rippling.com/careers/director-revops',
        location: 'Remote',
        department: 'Revenue Operations',
        description: 'Own the revenue tech stack, forecasting, and process across Sales, Marketing, and CS. Drive CRM hygiene, territory planning, and pipeline management.',
      },
      {
        title: 'Senior Director, GTM Strategy',
        url: 'https://rippling.com/careers/senior-director-gtm-strategy',
        location: 'Remote',
        department: 'Strategy',
        description: 'Lead competitive intelligence, market segmentation, and go-to-market planning for Ripplings HR and Finance products.',
      },
      {
        title: 'Corporate Account Executive',
        url: 'https://rippling.com/careers/corporate-ae',
        location: 'San Francisco, CA',
        department: 'Sales',
        description: 'Close enterprise deals for Rippling HCM. $2M+ quota. Must be based in SF.',
      },
    ],
    Deel: [
      {
        title: 'Head of Partner Strategy',
        url: 'https://deel.com/careers/head-partner-strategy',
        location: 'Remote',
        department: 'Partnerships',
        description: 'Build Deel\'s partner ecosystem strategy. Identify, recruit, and enable channel partners globally.',
      },
      {
        title: 'Content Marketing Manager',
        url: 'https://deel.com/careers/content-marketing',
        location: 'Remote',
        department: 'Marketing',
        description: 'Own Deel\'s content calendar. Write blog posts, guides, and case studies. SEO-focused.',
      },
    ],
    Amplitude: [
      {
        title: 'VP, Go-to-Market Strategy',
        url: 'https://amplitude.com/careers/vp-gtm-strategy',
        location: 'Remote',
        department: 'GTM',
        description: 'Define and execute Amplitude\'s go-to-market strategy across segments. Own market entry, pricing strategy, and competitive positioning. Report to CRO.',
      },
      {
        title: 'Senior Solutions Engineer',
        url: 'https://amplitude.com/careers/solutions-engineer',
        location: 'Remote',
        department: 'Sales Engineering',
        description: 'Support enterprise sales cycles with technical demos and integrations.',
      },
    ],
    Loom: [
      // No relevant jobs
      {
        title: 'Software Engineer, Backend',
        url: 'https://loom.com/careers/backend-engineer',
        location: 'San Francisco, CA',
        department: 'Engineering',
        description: 'Build Loom\'s video processing infrastructure at scale.',
      },
    ],
  };

  // Return company-specific mock data, or a default empty-ish set
  return allMocks[company] || [
    {
      title: 'Software Engineer',
      url: `https://${company.toLowerCase()}.com/careers/engineer`,
      location: 'Remote',
      department: 'Engineering',
      description: 'Build core product features.',
    },
  ];
}
