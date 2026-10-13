import { defineConfig, loadEnv } from '@medusajs/framework/utils'

import {
  assertCommerceDatabaseUrlNotDeclaredInLocalEnv,
  resolveCommerceCorsUrl,
  resolveCommerceDatabaseUrl,
  resolveCommerceSecret,
} from './src/isolation/env'

const environment = process.env.NODE_ENV || 'development'

loadEnv(environment, process.cwd())

// The Medusa CLI preloads .env before this config is evaluated, so a local
// declaration of COMMERCE_DATABASE_URL could otherwise decide the migration
// target without being attributable; refuse it instead of trusting it.
assertCommerceDatabaseUrlNotDeclaredInLocalEnv(process.cwd(), environment)

// The database comes from COMMERCE_DATABASE_URL only (see src/isolation/env.ts).
// DATABASE_URL belongs to the Mystcrag user database and is never a fallback.
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: resolveCommerceDatabaseUrl(process.env),
    http: {
      storeCors: resolveCommerceCorsUrl('STORE_CORS', process.env),
      adminCors: resolveCommerceCorsUrl('ADMIN_CORS', process.env),
      authCors: resolveCommerceCorsUrl('AUTH_CORS', process.env),
      jwtSecret: resolveCommerceSecret('JWT_SECRET', process.env),
      cookieSecret: resolveCommerceSecret('COOKIE_SECRET', process.env),
    },
  },
  modules: [
    {
      resolve: '@medusajs/medusa/translation',
    },
    {
      // Showroom publication approvals only (TASK-COMMERCE-GATE-001): the
      // versioned manual authorization, approved price fingerprint, per-locale
      // reviewed copy, approved media and audit trail. Products, prices and
      // collections themselves stay in Medusa.
      resolve: './src/modules/showroom-publication',
    },
  ],
  featureFlags: {
    translation: true,
  },
})