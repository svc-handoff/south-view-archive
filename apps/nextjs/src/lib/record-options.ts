export type RecordOption = {
  id: string;
  name: string;
  aliases?: string[];
  birthYear?: number;
  deathYear?: number;
  scope?: 'cemetery' | 'atlanta';
};
export const RECORD_OPTION_PAGE_SIZE = 12;
export function recordDescription(option: RecordOption) {
  if (option.scope) return option.scope === 'cemetery' ? 'South-View Cemetery' : 'Atlanta';
  if (option.birthYear && option.deathYear) return `${option.birthYear}–${option.deathYear}`;
  if (option.birthYear) return `Born ${option.birthYear}`;
  if (option.deathYear) return `Died ${option.deathYear}`;
  return '';
}
function searchable(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function filterRecordOptions(options: RecordOption[], query: string) {
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const text = searchable(
      [option.name, ...(option.aliases ?? []), recordDescription(option)].join(' '),
    );
    return terms.every((term) => text.includes(term));
  });
}
