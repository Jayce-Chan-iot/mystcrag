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
export const publicShowroomPolicy = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({
      code: 'METHOD_NOT_ALLOWED',
      message: 'The public showroom surface is read-only.',
    })
    return
  }

  const relayedCredential =
    req.headers['x-publishable-api-key'] !== undefined || req.headers.authorization !== undefined
  if (relayedCredential) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message:
        'The public showroom surface accepts no store or admin credentials; it is served by the publication gate only.',
    })
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
