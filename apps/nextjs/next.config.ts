import type { NextConfig } from 'next';
const config: NextConfig = {
  outputFileTracingExcludes: {
    '/*': ['../../.southview/**/*', '../../.data/**/*', '../../**/.env*', '../../**/*.log'],
  },
  transpilePackages: [
    '@southview/api',
    '@southview/db',
    '@southview/ui',
    '@southview/validators',
    '@southview/services',
  ],
  serverExternalPackages: [
    'postgres',
    '@electric-sql/pglite',
    'sharp',
    'nodemailer',
    'better-auth',
    '@better-auth/drizzle-adapter',
  ],
  async headers() {
    // Public pages may be embedded by South-View's Wix sites. Wix serves every HTML embed from its
    // own random *.filesusr.com host inside a *.wixsite.com, *.wix.com (editor and preview) or
    // custom-domain page, so whole Wix domains are allowed. Staff pages and sign-in stay unframeable
    // except by the archive itself; a later rule overrides the same header for those paths.
    const site = "'self' https://www.southviewpreservation.com https://southviewpreservation.com";
    const wix = 'https://*.filesusr.com https://*.wixsite.com https://*.wix.com https://*.wixstudio.com';
    const strict = [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${site} ${wix}` },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      { source: '/admin', headers: strict },
      { source: '/admin/:path*', headers: strict },
      { source: '/sign-in', headers: strict },
    ];
  },
};
export default config;
