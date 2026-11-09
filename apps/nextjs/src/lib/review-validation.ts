type ReviewIssue = { path: readonly PropertyKey[]; message: string };

const fieldLabels: Record<string, string> = {
  action: 'Decision',
  featured: 'Featured contribution',
  title: 'Public title',
  body: 'Public text',
  context: 'Public context',
  sourceCreator: 'Original author or creator',
  narrator: 'Narrator',
  holdingInstitution: 'Holding institution or collection',
  personId: 'Person',
  relatedPersonIds: 'Related people',
  placeIds: 'Places mentioned',
  eventDate: 'Event date',
  newPersonName: 'New person’s name',
  publicNote: 'Public editorial note',
  authorMessage: 'Message to the contributor',
  internalNote: 'Internal note',
  sourceIds: 'Sources',
  approvedPhotoIds: 'Approved photographs',
  applyTo: 'Publication',
  personPatch: 'Person record',
  'personPatch.name': 'Person name',
  'personPatch.aliases': 'Other names',
  'personPatch.birthYear': 'Birth year',
  'personPatch.deathYear': 'Death year',
  'personPatch.themes': 'Themes',
  'personPatch.occupations': 'Occupations',
  'personPatch.summary': 'Person summary',
  placePatch: 'Map place update',
  'placePatch.placeId': 'Place',
  'placePatch.name': 'Place name',
  'placePatch.scope': 'Area',
  'placePatch.coordinates': 'Coordinates',
  'placePatch.coordinates.0': 'Longitude',
  'placePatch.coordinates.1': 'Latitude',
  'placePatch.precision': 'Position precision',
  'placePatch.locationNote': 'Location evidence and limits',
  'placePatch.relationship': 'Person’s relationship to this place',
  'placePatch.summary': 'Place description',
  photoEdits: 'Photographs for publication',
};

const photoFieldLabels: Record<string, string> = {
  id: 'Photograph',
  caption: 'Public caption',
  creator: 'Creator',
  rights: 'Rights and use conditions',
};

function fieldLabel(path: readonly PropertyKey[], photoNumbers: readonly number[]): string {
  if (path[0] === 'photoEdits' && typeof path[1] === 'number') {
    const field = photoFieldLabels[String(path[2])];
    const number = photoNumbers[path[1]] ?? path[1] + 1;
    return `Photograph ${number}${field ? ` — ${field}` : ''}`;
  }
  // Use the closest named field for nested values such as dates and list entries.
  for (let length = path.length; length > 0; length--) {
    const label = fieldLabels[path.slice(0, length).map(String).join('.')];
    if (label) return label;
  }
  return path.length ? path.map(String).join('.') : 'Review';
}

export function formatReviewIssues(
  issues: readonly ReviewIssue[],
  photoNumbers: readonly number[] = [],
): string {
  return issues
    .map((issue) => `${fieldLabel(issue.path, photoNumbers)}: ${issue.message}`)
    .join(' ');
}
