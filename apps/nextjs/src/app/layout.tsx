import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'South-View — A Living Archive', template: '%s · South-View' },
  description:
    'Explore the people remembered at South-View Cemetery and the places connected to their lives. A source-led community history atlas.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
