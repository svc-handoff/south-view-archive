import { ExternalLink } from 'lucide-react';
import type { Citation, Source, ContributionCredit } from '@southview/validators';

function compactPageLocator(locator: string | undefined) {
  const pages = locator?.match(/\b(?:printed\s+|pdf\s+)?pages?\s+(\d+(?:\s*[–-]\s*\d+)?)/i)?.[1];
  if (!pages) return '';
  const compactPages = pages.replace(/\s/g, '').replace('-', '–');
  return `, ${compactPages.includes('–') ? 'pp.' : 'p.'}${compactPages}`;
}

export function CitationMarks({
  citations,
  sources,
}: {
  citations: Citation[];
  sources: Source[];
}) {
  if (citations.length === 0) return null;

  return (
    <sup className="citation-marks" aria-label="Sources">
      {citations.map((citation, index) => {
        const sourceIndex = sources.findIndex((source) => source.id === citation.sourceId);
        const source = sources[sourceIndex];
        if (!source) return null;
        return (
          <a
            className="citation-mark"
            href={`#source-${source.id}`}
            key={`${citation.sourceId}-${citation.locator ?? index}`}
            aria-label={`Source ${sourceIndex + 1}: ${source.title}${citation.locator ? `, ${citation.locator}` : ''}`}
            title={`${source.title}${citation.locator ? ` — ${citation.locator}` : ''}`}
          >
            [{sourceIndex + 1}
            {compactPageLocator(citation.locator)}]
          </a>
        );
      })}
    </sup>
  );
}

export function SourceList({
  sources,
  allSources = sources,
  citations = [],
  credits = [
    { id: 'initial-compilation', displayName: 'Initial archive compilation', kind: 'initial' },
  ],
}: {
  sources: Source[];
  allSources?: Source[];
  citations?: Citation[];
  credits?: ContributionCredit[];
}) {
  return (
    <ol className="source-list">
      {sources.map((source) => {
        const locators = [
          ...new Set(
            citations
              .filter((citation) => citation.sourceId === source.id)
              .map((citation) => citation.locator?.trim())
              .filter((locator): locator is string => Boolean(locator)),
          ),
        ];
        return (
          <li
            className="source-item"
            id={`source-${source.id}`}
            key={source.id}
            value={allSources.findIndex((item) => item.id === source.id) + 1}
            tabIndex={-1}
          >
            <span className="source-number" aria-hidden="true">
              {String(allSources.findIndex((item) => item.id === source.id) + 1).padStart(2, '0')}
            </span>
            <div>
              <a
                className="source-link"
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.title} <ExternalLink size={15} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <p className="source-meta">
                Author / creator: {source.creator}
                {source.publisher !== source.creator
                  ? ` · Institution / publisher: ${source.publisher}`
                  : ''}
                {source.date ? ` · ${source.date}` : ''}
              </p>
              <div className="provided-by">
                {source.creditIds.map((id) => {
                  const credit = credits.find((item) => item.id === id);
                  return credit ? (
                    <span key={id}>
                      {credit.displayName} — {source.title}
                    </span>
                  ) : null;
                })}
              </div>
              {source.catalogueId && <p className="source-meta">Catalogue: {source.catalogueId}</p>}
              <p className="source-meta">
                Accessed {source.accessedAt} · {source.kind.replace('-', ' ')}
              </p>
              {source.rights && <p className="source-meta">Rights: {source.rights}</p>}
              {source.note && <p className="source-meta">{source.note}</p>}
              {locators.length > 0 && (
                <p className="source-meta">Referenced passages: {locators.join('; ')}.</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
