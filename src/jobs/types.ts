export type JobLane = "assistance" | "gigs" | "mesh";
export type JobStatus = "found" | "drafting" | "applied" | "won";

export type JobCard = {
  id: string;
  lane: JobLane;
  title: string;
  who: string;
  amount: string | null;
  deadline: string | null;
  url: string;
  sourceName: string;
  why: string;
  nextStep: string;
  status: JobStatus;
  draft?: string;
  draftedAt?: string;
  example?: boolean;
  savedAt?: string;
};

export type HuntResult = {
  needsKey?: boolean;
  needsModel?: boolean;
  huntedAt?: string;
  lanes?: Record<string, { label: string; hits?: number; cards?: number; error?: string }>;
  cards?: JobCard[];
  message?: string;
  error?: string;
};

export type JobsState = {
  saved: JobCard[];
  dismissed: string[];
  lastHuntAt?: string;
};
