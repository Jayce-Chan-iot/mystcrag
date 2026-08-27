/**
 * Self-signed TLS certificate for the synthetic OIDC issuer host.
 *
 * The issuer must be `https://synthetic.auth006.internal/` (canonical HTTPS DNS hostname,
 * no port) because both the frontend config validator and the backend issuer validator
 * reject ports, IPs, and loopback hosts. The certificate lives only inside the run's
 * ignored output directory and is regenerated per run id.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export const SYNTHETIC_PROVIDER_HOST = "synthetic.auth006.internal";

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
      "/CN=synthetic.auth006.internal",
      "-addext",
      "subjectAltName=DNS:synthetic.auth006.internal"
    ],
    { timeout: 30_000 }
  );
  return { keyPath, certPath };
}
