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
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://www.southviewpreservation.com https://southviewpreservation.com https://18fc460d-2b61-480a-be02-baae6cf5798d.filesusr.com",
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;
