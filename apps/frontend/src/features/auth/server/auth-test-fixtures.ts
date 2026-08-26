/**
 * Shared fixtures for auth server-module tests.
 */

import { NextRequest } from "next/server";
import type { AuthConfig } from "../model/auth-config";

export function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    appOrigin: "https://app.mystcrag.com",
    authProvider: "auth0",
    authIssuer: "https://mystcrag.auth0.com/",
    authAudience: "mystcrag-backend",
    authClientId: "client-id",
    authClientSecret: "client-secret",
    authCallbackUrl: "https://app.mystcrag.com/auth/callback",
    authLogoutUrl: "https://app.mystcrag.com",
    authSessionSecret: "a".repeat(64),
    backendOrigin: "https://api.mystcrag.com",
    enableSignedTestAuth: false,
    ...overrides
  };
}

export function makeDevConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return makeConfig({
    appOrigin: "http://localhost:3000",
    authCallbackUrl: "http://localhost:3000/auth/callback",
    authLogoutUrl: "http://localhost:3000",
    backendOrigin: "http://127.0.0.1:4000",
    ...overrides
  });
}

export function makeRequest(
  url: string,
  init: RequestInit & { cookieHeader?: string } = {}
): NextRequest {
  const { cookieHeader, signal, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  return new NextRequest(url, { ...requestInit, headers, ...(signal ? { signal } : {}) });
}
