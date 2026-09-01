export {
  actorIdFromVerifiedContext,
  createAuthenticationPreHandler,
  type AccessTokenVerifier,
  type ActorContext,
  type AuthProvider,
  type VerifiedAuthClaims
} from "./auth-provider.js";
export {
  createAccessTokenVerifierFromEnvironment,
  type AuthEnvironment
} from "./auth-provider.factory.js";
export { AuthenticatedActorProvider } from "./authenticated-actor-provider.js";
export type {
  AuthenticatedActorProviderOptions,
  ExternalIdentityMappingInput,
  ExternalIdentityMappingPort,
  ExternalIdentityMappingResult
} from "./authenticated-actor-provider.js";
export { SignedTestTokenAuthProvider, signTestAccessToken, type SignedTestTokenClaims, type SignedTestTokenOptions } from "./signed-test-auth-provider.js";
