import { randomUUID } from 'node:crypto'

import {
  configureStoreSearch,
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse
} from '@medusajs/framework/http'

// Public showroom bypass policy (TASK-COMMERCE-GATE-001).
//
// The anonymous showroom surface is served only by the server-side publication
// gate. It is read-only and credential-free, so it can never be used to relay a
// native Medusa Store publishable key or an Admin/user bearer token into a raw,
// unfiltered store read: any such request is refused before it reaches a route.
// Every refusal uses the shared public error envelope with Medusa's requestId.
function sendRefusal(res: MedusaResponse, status: number, code: string, message: string, requestId?: string) {
  res.status(status).json({
    error: {
      code,
      message,
      requestId: requestId && requestId.trim().length > 0 ? requestId : randomUUID(),
    },
  })
}

export const publicShowroomPolicy = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendRefusal(res, 405, 'METHOD_NOT_ALLOWED', 'The public showroom surface is read-only.', req.requestId)
    return
  }

  const relayedCredential =
    req.headers['x-publishable-api-key'] !== undefined || req.headers.authorization !== undefined
  if (relayedCredential) {
    sendRefusal(
      res,
      400,
      'VALIDATION_ERROR',
      'The public showroom surface accepts no store or admin credentials; it is served by the publication gate only.',
      req.requestId
    )
    return
  }

  next()
}

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      matcher: /^\/api\/showroom(?:\/.*)?$/,
      middlewares: [publicShowroomPolicy],
    },
  ],
})
