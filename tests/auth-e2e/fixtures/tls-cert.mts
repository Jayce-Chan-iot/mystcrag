/**
 * Self-signed TLS certificate for the AUTH-006 synthetic DNS topology.
 *
 * Three synthetic DNS hosts share one certificate (multi-SAN):
 *
 *   synthetic.auth006.internal — the synthetic OIDC issuer (canonical https://host/,
 *                                no port: the Auth0 SDK and both issuer validators
 *                                reject ports, IPs, and loopback hosts)
 *   app.mystcrag.auth006.internal — production-topology app origin (scenario I)
 *   api.mystcrag.auth006.internal — production-topology backend origin (scenario I)
 *
 * The certificate lives only inside the run's ignored output directory and is
 * regenerated per run id. NODE_EXTRA_CA_CERTS trusts it for every Node runtime; the
 * Playwright browser contexts run with ignoreHTTPSErrors for the same hosts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

import { PRODUCTION_API_HOST, PRODUCTION_APP_HOST, SYNTHETIC_PROVIDER_HOST } from "./ports";

const execFileAsync = promisify(execFile);

export async function ensureSyntheticTlsCertificate(directory) {
  await fs.mkdir(directory, { recursive: true });
  const keyPath = path.join(directory, "synthetic-provider.key.pem");
  const certPath = path.join(directory, "synthetic-provider.cert.pem");

  try {
    await fs.access(keyPath);
    await fs.access(certPath);
    return { keyPath, certPath };
  } catch {
    // Regenerate when either file is missing.
  }

  await execFileAsync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "7",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      `/CN=${SYNTHETIC_PROVIDER_HOST}`,
      "-addext",
      `subjectAltName=DNS:${SYNTHETIC_PROVIDER_HOST},DNS:${PRODUCTION_APP_HOST},DNS:${PRODUCTION_API_HOST}`
    ],
    { timeout: 30_000 }
  );
  return { keyPath, certPath };
}
