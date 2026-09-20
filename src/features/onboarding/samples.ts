/** Only these fields are sent to the classification API. */
export interface OnboardingSample {
  inputs: string[];
  labels: string[];
  instructions: string;
}

/** Presentation copy stays out of API request bodies. */
export const onboardingSamplePresentation: Record<
  string,
  { summary: string; outcome: string }
> = {
  "Filter research": {
    summary:
      "Turn a battery-storage reading list into a focused research queue.",
    outcome:
      "Prioritize 10 supplied abstracts: primary evidence, background reading, out of scope, or insufficient detail.",
  },
  "Group feedback": {
    summary: "Turn a mixed feedback inbox into a useful product triage.",
    outcome:
      "Route 10 messages, including mixed requests and unclear feedback, then summarize each queue.",
  },
  "Sort files": {
    summary: "Propose a filing plan for a messy Downloads folder.",
    outcome:
      "Assign 10 supplied filename-and-excerpt records to folders without opening or moving files.",
  },
  "Just exploring": {
    summary: "Separate positive, negative, and neutral customer reactions.",
    outcome: "Classify three supplied comments by sentiment.",
  },
};

export const onboardingSamples: Record<string, OnboardingSample> = {
  "Filter research": {
    inputs: [
      "R01 | Community solar, stored overnight | Field study: a 5 MWh battery at a community solar site was monitored for 12 months. The abstract reports round-trip efficiency, capacity loss, and electricity delivered during evening peaks.",
      "R02 | The battery-storage market explained | An introductory industry guide defines energy capacity, power output, and discharge duration. It explains where grid batteries are used but contains no measured or modeled results.",
      "R03 | Extending smartphone battery life | A consumer guide compares display settings and background-app restrictions on phone runtime. It does not discuss stationary or grid energy storage.",
      "R04 | A lower-cost route to ten-hour storage | A simulation compares iron-air and lithium-ion systems for a wind-heavy electricity grid, reporting modeled cost per delivered MWh and sensitivity to cycle life. It is not a field trial.",
      "R05 | Major storage breakthrough announced | A teaser says a new battery will change everything. It gives no application, study method, capacity, efficiency, cost, or abstract.",
      "R06 | Can retired EV packs support the grid? | A 2 MWh stationary pilot uses retired vehicle batteries for grid peak shaving. Its measured results report 86% round-trip efficiency and $14 per MWh maintenance cost over one year. These are field measurements, not EV-driving results.",
      "R07 | Policy barriers to long-duration storage | An opinion essay explains interconnection rules for stationary batteries. It provides background policy context only: no measured results, numerical cost estimates, or simulations.",
      "R08 | Recovering lithium from manufacturing scrap | A laboratory study compares chemical recovery yields from discarded smartphone batteries. Its scope is phone-battery recycling, with no evaluation of stationary or grid-storage systems.",
      "R09 | When storage reduces renewable curtailment | A grid dispatch model compares four-, eight-, and twelve-hour battery systems. It reports curtailment avoided, utilization, and system cost under three renewable-generation scenarios.",
      "R10 | What grid-storage cost estimates leave out | A methods overview lists installation, augmentation, maintenance, and end-of-life costs that analysts should consider. It does not calculate or compare any system costs.",
    ],
    labels: [
      "primary evidence",
      "background reading",
      "out of scope",
      "insufficient detail",
    ],
    instructions:
      "Research topic: performance and economics of stationary batteries serving the electricity grid. Choose primary evidence for a relevant field trial or simulation reporting performance, cost, or grid results; stationary reuse of EV batteries qualifies. Choose background reading for relevant definitions, policy commentary, or methods overviews WITHOUT measured or modeled results. Choose out of scope for phone batteries or recycling studies with no grid-storage evaluation. Choose insufficient detail when the excerpt does not establish what was studied. Judge the excerpt, not the title. These are fictional examples, not verified research.",
  },
  "Group feedback": {
    inputs: [
      "F01 | Export | Since yesterday's release, Export CSV returns a 500 error for every report. I tried two browsers and still cannot download anything.",
      "F02 | Scheduled reports | Could you email our weekly report every Monday? We currently export it manually and send it to the team.",
      "F03 | Finding a setting | Where can I change the timezone used in reports? I have not found the setting, but I may be looking in the wrong place.",
      "F04 | Search | Saved searches are brilliant. Our weekly review now takes minutes instead of an hour. No changes needed.",
      "F05 | Mixed feedback | Love the new dashboard, but the Save button stays disabled after I edit a filter. Please fix that before adding more chart types.",
      "F06 | New integration | Your Jira integration works, but our team uses Linear. Please build a new Linear integration; I am requesting a new capability, not reporting a broken integration.",
      "F07 | Invitation question | I can see the existing Guest role in settings. How do I assign that role to a contractor and choose which project they can access?",
      "F08 | Performance regression | The same report that loaded in two seconds last week now takes over a minute, and sometimes times out. Nothing about our dataset changed.",
      "F09 | Vague follow-up | Following up on the thing we discussed yesterday. Can someone take care of it? I have not included the earlier conversation.",
      "F10 | Request with a workaround | The export works, thanks. Could you add an option to exclude archived records? We can remove them in a spreadsheet for now.",
    ],
    labels: [
      "bug report",
      "feature request",
      "usage question",
      "positive feedback",
      "missing context",
    ],
    instructions:
      "Route each customer message by its main intent. bug report: an existing feature fails, is broken, or has become slower. feature request: asking to add a new capability; an unsupported integration is not a malfunction. usage question: asking how to use a capability, including an existing role or setting. positive feedback: praise with no request or problem. missing context: a vague follow-up whose issue cannot be identified without an earlier conversation. A concrete malfunction overrides accompanying praise or requests. A request overrides praise. Do not invent a defect or missing capability when none is stated.",
  },
  "Sort files": {
    inputs: [
      "D01 | invoice-1042.pdf | INVOICE 1042. Studio North consulting services. Amount due: $1,200. Payment due: October 1. Bank transfer instructions follow.",
      "D02 | receipt-coffee.png | Card purchase approved. Office coffee supplies, total $46.20. Paid in full on September 12. Transaction reference: SAMPLE-781.",
      "D03 | vendor-agreement-draft.docx | Draft services agreement between Harbor Studio and North Analytics. Scope of work, confidentiality, termination, and signature blocks are included; neither party has signed.",
      "D04 | interviews-round2.md | Five onboarding interviews. Participants could not find the invite button; three expected teammates to share a workspace. Quotes and research observations follow.",
      "D05 | monday-sync.txt | Weekly operations meeting. Dana will check the launch checklist; Lee will update support coverage. Next check-in: Monday at 10.",
      "D06 | final-contract-notes.txt | Notes from a meeting about the vendor contract: ask procurement to review clause 8; schedule a follow-up. This document contains no agreement terms or signatures.",
      "D07 | invoice-paid-1040.pdf | INVOICE 1040. Design services, $800. Original payment terms and line items are followed by a PAID stamp. This is the original invoice with its status updated.",
      "D08 | scan-004.pdf | Only a blurred logo and the words total and date are legible. No amount, payment status, document title, or other content can be read.",
      "D09 | onboarding-results.csv | Columns: participant, first-task completion time, invite-button found, notes. Ten rows from a usability test compare two onboarding layouts.",
      "D10 | project-backup.zip | No excerpt is available. The archive's contents have not been inspected.",
    ],
    labels: [
      "Finance/Invoices",
      "Finance/Receipts",
      "Legal/Agreements",
      "Product/Research",
      "Operations/Notes",
      "Needs review",
    ],
    instructions:
      "Propose a filing folder for each supplied filename-and-excerpt record. These are sample records, not files you can access. Finance/Invoices = invoices or payment requests, including an original invoice marked paid. Finance/Receipts = receipts or transaction confirmations showing a completed purchase. Legal/Agreements = actual agreement terms, including unsigned drafts; notes discussing an agreement are not agreements. Product/Research = user interviews, usability findings, or research datasets. Operations/Notes = meeting notes, action lists, or operating checklists. Needs review = insufficient readable content or an unknown type, including an uninspected archive. Prefer the excerpt over a misleading filename. Never infer archive contents, rename, open, move, or delete files; return a proposed folder only.",
  },
  "Just exploring": {
    inputs: [
      "The package arrived on time and works perfectly.",
      "The item was damaged and support never replied.",
      "The package contains a blue cable.",
    ],
    labels: ["positive", "negative", "neutral"],
    instructions: "Classify the sentiment expressed in each text.",
  },
};
