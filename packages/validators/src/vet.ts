import { z } from 'zod';

export const VET_MODEL = 'gpt-6-luna';
export const VET_PROMPT_VERSION = 'south-view-v1';
export const vetReportSchema = z.object({
  summary: z.string().max(6000),
  spam_flag: z.boolean(),
  claims: z
    .array(
      z.object({
        claim_text: z.string().max(2000),
        verdict: z.enum(['contradicted', 'questionable', 'corroborated', 'unverified']),
        explanation: z.string().max(4000),
        evidence: z
          .array(
            z.object({
              title: z.string().max(500),
              url: z.string().nullable(),
              submission_ref: z.string().nullable(),
              source_type: z.enum(['submitted-link', 'web-search', 'submission']),
              relevance: z.string().max(2000),
            }),
          )
          .max(12),
        reviewer_note: z.string().max(2000),
      }),
    )
    .max(40),
  follow_up_questions: z.array(z.string().max(2000)).max(20),
  limitations: z.array(z.string().max(2000)).max(20),
});
export type VetReport = z.infer<typeof vetReportSchema>;
export type VetAttachment = {
  id: string;
  label: string;
  status: 'provided' | 'unavailable' | 'unsupported';
};
export type VetRun = {
  id: string;
  submissionId: string;
  status: 'running' | 'completed' | 'failed';
  model: string;
  promptVersion: string;
  inputRevision: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  report: VetReport | null;
  attachments: VetAttachment[];
  sources: { url: string; title: string }[];
  outdated: boolean;
};
export type VetOverview = {
  configured: boolean;
  runs: Record<string, VetRun>;
  runningSubmissionId: string | null;
};
