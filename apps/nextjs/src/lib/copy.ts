/**
 * Canonical user-facing wording. Usability testing on 2026-10-21 found that the same action was
 * labelled differently in the navigation, page headings and buttons, so every surface that names
 * the contribution flow reads from here.
 */
export const copy = {
  /** The single verb for contributing, used in navigation, headings and calls to action. */
  share: 'Share a story',
  shareAbout: (name: string) => `Share a story about ${name}`,
  reviewStory: 'Review my story',
  sendStory: 'Send my story for review',
  sending: 'Sending your story…',
  explore: 'Explore',
  editPage: 'Edit this page',
  addToPage: 'Add to this page',
  preview: 'Preview',
  backToEditing: 'Back to editing',
  exitEditing: 'Exit editing',
  awaitingReview: 'Your addition · awaiting review · not public yet',
  addPerson: 'Add a person',
  account: 'My contributions',
  reviewDesk: 'Archive admin',
  editParagraph: 'Edit this paragraph',
  requiredLegend: 'Fields marked * are required. Everything else is optional.',
  noEmail:
    'The archive does not send email. After you send your story, save the private link shown on the next page: it is the only way back to your submission.',
} as const;
