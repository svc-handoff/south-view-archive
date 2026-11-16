# Archive form improvements

Implement the user's specified behavior in the existing Next.js components. Work in the current checkout so the local preview includes the committed changes.

- Remove profile editing entry points; link contribution calls to action to Share a story.
- Keep an explicit unlisted-person selection visible without treating it as an archive record.
- Default People to alphabetical order; widen its scrollbar; use the Search placeholder.
- Merge reviewer Submission and Public draft into one tab; keep History separate.
- Render validation errors beside their fields, open enclosing details, and focus/scroll to the first error. For reviewer publication failures, dismiss confirmation and reveal the public draft field when necessary. Keep non-field failures near the action.
- Add an optional private phone number to contribution validation, contact persistence, preview, and reviewer contact display. Exclude it from public submission JSON and AI research.
- Verify validation mapping and private phone round trips with regression tests, run type checks/full tests/build, inspect the local UI, commit, and leave localhost running. Do not push.
