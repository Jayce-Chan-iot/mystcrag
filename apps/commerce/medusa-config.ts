import { defineConfig, loadEnv } from '@medusajs/framework/utils'

import {
  resolveCommerceCorsUrl,
  resolveCommerceDatabaseUrl,
  resolveCommerceSecret,
} from './src/isolation/env'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

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
  ],
  featureFlags: {
    translation: true,
  },
})