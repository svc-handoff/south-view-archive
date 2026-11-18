import { z } from 'zod';

/**
 * The AI review connection staff set in the admin. `apiKey` omitted keeps the saved key, an empty
 * string removes it (falling back to the server's OPENAI_API_KEY, if any). Empty base URL or model
 * means the server default.
 */
export const aiSettingsInputSchema = z.object({
  apiKey: z.string().trim().max(400).optional(),
  baseURL: z
    .string()
    .trim()
    .max(300)
    .refine(
      (value) => value === '' || /^https:\/\/[^\s/$.?#][^\s]*$/i.test(value),
      'Use a full https:// address, such as https://api.openai.com/v1.',
    ),
  model: z
    .string()
    .trim()
    .max(120)
    .refine((value) => value === '' || /^[\w.:/-]+$/.test(value), 'Use the model’s name, such as gpt-5.'),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

/** Whether the public site is taken down, and the note visitors see meanwhile. */
export const siteStatusInputSchema = z.object({
  offline: z.boolean(),
  message: z.string().trim().max(500).default(''),
});
export type SiteStatusInput = z.infer<typeof siteStatusInputSchema>;
export type SiteStatus = { offline: boolean; message: string };

/** What the admin may see: never the key itself, only whether one is saved and its last characters. */
export type SettingsView = {
  ai: {
    baseURL: string;
    model: string;
    keySource: 'admin' | 'server' | 'none';
    keyHint: string | null;
    defaultBaseURL: string;
    defaultModel: string;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  site: SiteStatus & { updatedBy: string | null; updatedAt: string | null };
};
