# Staff vetting with Luna and web search

The review desk at `/admin/contributions` uses **GPT-6 Luna (`gpt-6-luna`)**, medium reasoning, and the OpenAI Responses API web search tool. Every check is one awaited Responses request, with required web search and structured JSON output. There is no queue, background worker, automatic publication, or alternate-model fallback.

## Enable locally

1. Configure the existing `local` or `database` mode and a reviewer account. `fixture` remains read-only.
2. Set `OPENAI_API_KEY` in `apps/nextjs/.env.local`, using an OpenAI project with access to GPT-6 Luna and web search. Next.js does not read the repository root `.env.local`; that file is used by database/administration scripts. Never use a `NEXT_PUBLIC_` variable. Do not commit the key or paste it into a contribution.
3. Restart the application. File-backed local mode applies migration `0005_vet.sql` automatically. In database mode, run the existing `pnpm db:migrate` command using the migration database connection before starting the updated application.
4. Open a submission and click **Vet**. Missing credentials show **Not configured**. A configured key is a readiness indication, not proof of model access or available quota.

For deployment, add the server-only key in the deployment platform and apply the migration. The community route requests a 300-second function duration; the awaited check has a 240-second deadline and the OpenAI request a 210-second timeout. Confirm that the hosting plan and proxy allow these durations. The 2026-10-19 production release and migration are recorded in [VERCEL.md](VERCEL.md); the OpenAI key is intentionally being configured later.

## What staff see

Each claim has a verdict (corroborated, contradicted, questionable, or unverified), an explanation, evidence, and a reviewer note. The report includes a summary, possible spam concerns, follow-up questions, limitations, attachment coverage, model, and timestamp. Insufficient online evidence is explicitly different from contradictory evidence. Community memories and oral history can be sources in their own right.

Checks concern the **submitted original and supplements**, not unsaved public-draft edits. Approve, Reject, Request information, and Withdraw remain human decisions. New supplements or photos make a previous result stale. Running checks do not prevent browsing or human review. A refresh restores persisted results; one check can run across the whole desk at a time. The server also enforces this across sessions and processes.

All run records, including failures and reruns, remain in `community.vet_runs`; the dashboard displays the latest run for each submission. Successful reports persist before the response returns. An interrupted run expires after five minutes and becomes retryable on the next staff read/start. A late response cannot overwrite a newer check. Staff are limited to 20 starts per hour; provider calls have automatic retries disabled.

## Data and evidence boundaries

- The server sends selected submission text, supplied public source links, relevant public person/place context, and processed photos. Structured private contact names, email, account IDs, receipt tokens, private object keys, and internal review notes are excluded. Exact known private contact values are also redacted from free text. Staff should still review material for other personal information; content visible within photos is included in model input.
- Supported attachments remain JPEG, PNG, and WebP, up to the existing five-photo limit. Images are read through existing private local/S3/R2 storage and re-encoded without metadata. Original files remain private. “Image supplied” means bytes reached the request, not that the model authenticated or fully understood a photo. Missing/unsupported files are explicitly listed; PDF and other documents are links only.
- User material and web results are treated as untrusted evidence. The model cannot call application actions or publish. Only the web search tool is available.
- The server verifies each cited web URL against the Responses search-source metadata or URL annotations, and submitted-link citations against supplied links. Invalid citations fail the check. This validates provenance, not the truth or relevance of a claim: reviewers must assess the cited sources.
- Responses use `store: false`. Submitted material is still sent to OpenAI for processing, and research queries go through the web search tool. The application does not log request bodies, provider diagnostics, or API keys.
- Vet endpoints require an authenticated reviewer and same-origin writes. Reports are private and are not included in public archive APIs or contributor receipt responses. The new table has RLS enabled, no public policies, and is accessed through the server database role.

## Validation and live acceptance

Automated tests exercise the official SDK with a mocked HTTP transport: request configuration, missing configuration, permissions, privacy exclusions, image handling, persistent reports across database restart, duplicate starts, interrupted-run recovery, malformed/invented citations, provider failure, stale results, reruns, and independent human publication. These tests do not make real OpenAI calls and do not establish live model quality or latency.

After adding the key, use a clearly labeled test submission to verify a real first check, clickable returned citations, a memory with no independent record, a deliberately conflicting date, and an image. Confirm that failed or uncertain findings never publish automatically. Actual GPT-6 Luna/web-search integration has not been live-tested in this delivery because the key is intentionally being configured later.

Official references: [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
