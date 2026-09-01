/**
 * Shared fixtures for auth server-module tests.
 */

import { NextRequest } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { createAuthEventLogger, type AuthEventLogger, type AuthEventRecord } from "./auth-events";

/** No-op logger for tests that do not assert on auth events. */
export const noopAuthEventLogger: AuthEventLogger = () => {};

export type CapturedAuthEvents = {
  readonly logger: AuthEventLogger;
  readonly records: AuthEventRecord[];
};

/** Captures privacy-sanitized auth event records for assertions. */
export function makeAuthEventCapture(): CapturedAuthEvents {
  const records: AuthEventRecord[] = [];
  return {
    logger: createAuthEventLogger((record) => {
      records.push(record);
    }),
    records
  };
}

export function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    appOrigin: "https://app.mystcrag.com",
    environment: "production",
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
    environment: "development",
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
