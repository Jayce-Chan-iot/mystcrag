/**
 * Validates and sanitizes returnTo paths for authentication redirects.
 *
 * Contract: only same-origin relative paths starting with exactly one `/` are accepted.
 * Rejects: absolute URLs, protocol-relative `//`, backslashes, control characters,
 * encoded authority/scheme bypasses, and malformed/repeated-encoded redirects.
 * Invalid values fall back to `/`; they are never reflected to Auth0.
 */

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.\-]*:/i;
const AUTHORITY_PATTERN = /^\/\//;
const BACKSLASH_PATTERN = /\\/;

export function validateReturnTo(value: string | undefined | null): string {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }

  // Reject control characters
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return "/";
  }

  // Reject backslashes (can be interpreted as slashes by some parsers)
  if (BACKSLASH_PATTERN.test(value)) {
    return "/";
  }

  // Reject absolute URLs (scheme://...)
  if (SCHEME_PATTERN.test(value)) {
    return "/";
  }

  // Reject protocol-relative URLs (//authority)
  if (AUTHORITY_PATTERN.test(value)) {
    return "/";
  }

  // Must start with exactly one /
  if (!value.startsWith("/")) {
    return "/";
  }

  // Reject if it starts with /// (authority bypass attempt)
  if (value.startsWith("///")) {
    return "/";
  }

  // Decode and re-validate to catch double-encoding attacks
  try {
    let current = value;
    let previous = value;
    // Iteratively decode until stable (catches multi-layer encoding)
    for (let i = 0; i < 10; i++) {
      current = decodeURIComponent(current);
      if (current === previous) break;
      previous = current;
      // Re-validate at each decode level
      if (SCHEME_PATTERN.test(current) || AUTHORITY_PATTERN.test(current) || BACKSLASH_PATTERN.test(current) || CONTROL_CHAR_PATTERN.test(current) || !current.startsWith("/") || current.startsWith("///")) {
        return "/";
      }
    }
  } catch {
    // Malformed encoding
    return "/";
  }

  return value;
}
