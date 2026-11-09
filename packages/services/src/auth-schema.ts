import {
  bigint,
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const community = pgSchema('community');
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const user = community.table('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
});
export const session = community.table(
  'auth_session',
  {
    id: text('id').primaryKey(),
    expiresAt: time('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('auth_session_user_idx').on(table.userId)],
);
export const account = community.table(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: time('access_token_expires_at'),
    refreshTokenExpiresAt: time('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('auth_account_user_idx').on(table.userId),
    uniqueIndex('auth_account_provider_idx').on(table.providerId, table.accountId),
  ],
);
export const verification = community.table(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: time('expires_at').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (table) => [index('auth_verification_identifier_idx').on(table.identifier)],
);
export const rateLimit = community.table('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
export const reviewers = community.table('reviewers', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: time('created_at').notNull().defaultNow(),
  grantedBy: text('granted_by'),
});
