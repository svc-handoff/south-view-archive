import Link from 'next/link';
import type { ArchiveData } from '@southview/validators';
import { withArchiveReturn } from '@/lib/archive-return';

export function ProvidedBy({
  creditIds,
  title,
  data,
  returnTo,
}: {
  creditIds: string[];
  title: string;
  data: ArchiveData;
  returnTo?: string;
}) {
  return (
    <div className="provided-by">
      {creditIds.map((id) => {
        const credit = data.credits.find((item) => item.id === id);
        if (!credit) return null;
        const entry = data.contributions.find((item) => item.creditId === id);
        const path = entry ? `/contributions/${encodeURIComponent(entry.id)}` : null;
        const text = `${credit.displayName} — ${title}`;
        return (
          <span key={id}>
            {path ? (
              <Link href={returnTo ? withArchiveReturn(path, returnTo) : path}>{text}</Link>
            ) : (
              text
            )}
          </span>
        );
      })}
    </div>
  );
}
