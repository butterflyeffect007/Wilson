/** Screenshot-only fixture. Never used as a live hunt result. Clearly labeled example data. */
import type { JobCard } from "./types";

export const EXAMPLE_BANNER = "Example data for preview only. This is not a live Money Hunt.";

export const EXAMPLE_CARDS: JobCard[] = [
  {
    id: "example-rent",
    lane: "assistance",
    title: "Example: Austin emergency rent help (sample)",
    who: "Example — households in Austin, Texas",
    amount: "Example only — amount not from a live hunt",
    deadline: "Example only — no real deadline",
    url: "https://example.com/jobs-example/austin-rent-help",
    sourceName: "example.com",
    why: "This is sample preview data so the Jobs room can be shown. It is not a real program.",
    nextStep: "In a real hunt, you would open the official source yourself. Wilson never applies for you.",
    status: "found",
    example: true,
  },
  {
    id: "example-gig",
    lane: "gigs",
    title: "Example: remote prompt-engineer gig (sample)",
    who: "Example — AI orchestrator / prompt engineer, remote",
    amount: null,
    deadline: null,
    url: "https://example.com/jobs-example/prompt-engineer-gig",
    sourceName: "example.com",
    why: "Sample card only. A live hunt would use a real posting Wilson actually found.",
    nextStep: "In a real hunt, read the official posting before you decide.",
    status: "found",
    example: true,
  },
  {
    id: "example-mesh",
    lane: "mesh",
    title: "Example: open-source networking grant (sample)",
    who: "Example — Sunflower Protocol / open-source mesh work",
    amount: "Example only — no real award amount",
    deadline: "Example only",
    url: "https://example.com/jobs-example/mesh-grant",
    sourceName: "example.com",
    why: "Sample card only, to show how a grant would appear in this lane.",
    nextStep: "In a real hunt, open the official grant page yourself.",
    status: "found",
    example: true,
  },
];

export const EXAMPLE_DRAFT = `EXAMPLE DRAFT — preview only. This was not written from a live opportunity.

Dear [name or program],

I'm Jenny, writing from Austin, Texas. I'm interested in [the example opportunity]. This draft is only here so I can see how Wilson's "Wilson, draft it" view looks. It is not a real application, and Wilson will not send it.

What I'd like you to know: [I'll fill this in from the real source page.]

Thank you for your time,
Jenny

(Wilson never submits, emails, or contacts anyone. I review this, copy it, and send it myself.)`;
