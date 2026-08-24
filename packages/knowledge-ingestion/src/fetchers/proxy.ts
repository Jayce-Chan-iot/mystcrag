import { ProxyConfiguration } from "crawlee";

import { isPrivateHostname } from "../security.js";

/**
 * Egress proxy wiring for environments where direct connections to some
 * sources are unavailable (e.g. a corporate/dev proxy in HTTPS_PROXY). curl
 * honours these variables; Node's fetch stack does not, so the crawler must
 * be configured explicitly or those sources time out at connect time.
 */
export function proxyUrlsFromEnv(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy];
  const urls: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (!urls.includes(value)) urls.push(value);
  }
  return urls;
}

export function noProxyHostsFromEnv(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env.NO_PROXY ?? env.no_proxy ?? "";
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isNoProxyHost(hostname: string, hosts: readonly string[]): boolean {
  if (hosts.includes("*")) return true;
  const host = hostname.toLowerCase();
  return hosts.some((entry) => {
    const bare = entry.replace(/^\./, "");
    return host === bare || host.endsWith(`.${bare}`);
  });
}

/**
 * Private/loopback hosts always connect directly: production never crawls them
 * (the SSRF guard rejects them), while local test fixture servers must not be
 * routed through an ambient dev proxy — the proxy's 127.0.0.1 is not ours.
 * NO_PROXY entries extend the bypass set, with standard suffix matching.
 */
export function proxyConfigurationFromEnv(
  env: Record<string, string | undefined> = process.env
): ProxyConfiguration | undefined {
  const urls = proxyUrlsFromEnv(env);
  if (urls.length === 0) return undefined;
  const noProxyHosts = noProxyHostsFromEnv(env);
  let rotation = 0;
  return new ProxyConfiguration({
    newUrlFunction: (_sessionId, options) => {
      const requestUrl = options?.request?.url;
      if (requestUrl !== undefined) {
        const hostname = new URL(requestUrl).hostname;
        if (isPrivateHostname(hostname) || isNoProxyHost(hostname, noProxyHosts)) {
          return null;
        }
      }
      const url = urls[rotation % urls.length]!;
      rotation += 1;
      return url;
    }
  });
}
