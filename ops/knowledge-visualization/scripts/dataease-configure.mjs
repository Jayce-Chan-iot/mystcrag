#!/usr/bin/env node
/**
 * Configures the DataEase desktop BI with the Mystcrag read-only PostgreSQL
 * datasource via the de2api REST API.
 *
 * Usage: node dataease-configure.mjs [--base http://127.0.0.1:8100]
 * Reads:
 *   - ops/knowledge-visualization/.env          (MYSTCRAG_READER_PASSWORD)
 *   - ~/opt/dataease2.0/substitule.json         (desktop admin pwd, local only)
 */
import { readFileSync } from "node:fs";
import { createHash, createDecipheriv, createPublicKey, publicEncrypt, constants } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i > 0 ? process.argv[i + 1].replace(/\/$/, "") : "http://127.0.0.1:8100";
})();
const API = `${BASE}/de2api`;

function envFile() {
  const raw = readFileSync(path.join(ROOT, "ops/knowledge-visualization/.env"), "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function aesCbcDecrypt(ciphertextB64, passphrase) {
  const key = Buffer.from(passphrase, "utf8");
  const iv = createHash("sha256").update(passphrase, "utf8").digest().subarray(0, 16);
  const d = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  return Buffer.concat([d.update(Buffer.from(ciphertextB64, "base64")), d.final()]).toString("utf8");
}

async function login() {
  const dekey = (await (await fetch(`${API}/dekey`)).json()).data;
  const sep = Buffer.from("-pk_separator-", "utf8").toString("base64").replace(/=+$/, "") + "=";
  const [cipher, pass] = dekey.split(sep);
  const pem = aesCbcDecrypt(cipher, pass);
  const pub = createPublicKey(
    pem.includes("-----BEGIN") ? pem : `-----BEGIN PUBLIC KEY-----\n${pem}\n-----END PUBLIC KEY-----`,
  );
  const enc = (t) =>
    publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(t, "utf8")).toString("base64");
  const cred = JSON.parse(readFileSync(`${homedir()}/opt/dataease2.0/substitule.json`, "utf8"));
  const res = await fetch(`${API}/login/localLogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: enc("admin"), pwd: enc(cred.pwd) }),
  });
  const json = await res.json();
  if (json.code !== 0 || !json.data?.token) throw new Error(`login failed: ${json.msg}`);
  return json.data.token;
}

async function api(token, url, body) {
  const res = await fetch(`${API}${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-DE-TOKEN": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const env = envFile();
  const token = await login();
  console.log("DATASEASE LOGIN: PASS");

  const configuration = {
    host: env.MYSTCRAG_READER_HOST || "localhost",
    jdbc: "",
    port: Number(env.MYSTCRAG_READER_PORT || 5432),
    dataBase: env.MYSTCRAG_READER_DB || "mystcrag",
    username: env.MYSTCRAG_READER_USER || "mystcrag_reader",
    password: env.MYSTCRAG_READER_PASSWORD,
    extraParams: "",
    schema: "public",
    initialPoolSize: 5,
    minPoolSize: 5,
    maxPoolSize: 10,
    queryTimeout: 30,
  };
  const configurationB64 = Buffer.from(JSON.stringify(configuration)).toString("base64");

  const validate = await api(token, "/datasource/validate", {
    type: "pg",
    configuration: configurationB64,
  });
  if (validate.code !== 0) throw new Error(`validate failed: ${JSON.stringify(validate)}`);
  console.log("DATASOURCE VALIDATE: PASS");

  const list = await api(token, "/datasource/list", { keyword: "" }).catch(() => null);
  const save = await api(token, "/datasource/save", {
    name: "Mystcrag Read Only",
    type: "pg",
    catalog: "OLTP",
    description: "Mystcrag knowledge PostgreSQL, read-only mystcrag_reader role",
    configuration: configurationB64,
  });
  if (save.code !== 0) throw new Error(`save failed: ${JSON.stringify(save)}`);
  console.log("DATASOURCE SAVE: PASS");

  const tree = await api(token, "/datasource/getTree", {});
  const pgNode = JSON.stringify(tree).includes("Mystcrag Read Only");
  console.log(`DATASOURCE TREE CONTAINS ENTRY: ${pgNode ? "PASS" : "CHECK_MANUALLY"}`);

  const dsId = save.data?.id ?? tree?.data?.[0]?.id;
  if (dsId) {
    const tables = await api(token, `/datasource/getTables/${dsId}`, {});
    const names = JSON.stringify(tables);
    for (const t of ["knowledge_sources", "knowledge_rules", "knowledge_collection_runs"]) {
      console.log(`TABLE ${t}: ${names.includes(t) ? "VISIBLE" : "MISSING"}`);
    }
  }
  console.log("IGNORE_LIST_HINT:", list ? "list ok" : "list endpoint n/a");
}

main().catch((e) => {
  console.error("CONFIGURE FAILED:", e.message);
  process.exit(1);
});
