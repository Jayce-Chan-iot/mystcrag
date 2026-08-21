import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express, type Request, type Response } from "express";

import { createMcpServer } from "./server.js";
import { createMcpRuntime, type McpRuntime } from "./runtime.js";

const USAGE = `Usage: mcp-server [--transport stdio|http] [--host HOST] [--port PORT]
Environment: DATABASE_URL (required), MCP_TRANSPORT, MCP_HOST, MCP_PORT
  --transport stdio  Streamable JSON-RPC over stdin/stdout (default)
  --transport http   Streamable HTTP at http://HOST:PORT/mcp (stateless, sessionless)`;

function parseArguments(argv: readonly string[]): {
  transport: "stdio" | "http";
  host: string;
  port: number;
} {
  const config: { transport: "stdio" | "http"; host: string; port: number } = {
    transport:
      process.env.MCP_TRANSPORT === "http" || process.env.MCP_TRANSPORT === "stdio"
        ? process.env.MCP_TRANSPORT
        : "stdio",
    host: process.env.MCP_HOST ?? "127.0.0.1",
    port: Number(process.env.MCP_PORT ?? 3001)
  };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === "--transport" && (next === "stdio" || next === "http")) {
      config.transport = next;
      index += 1;
    } else if (flag === "--host" && next !== undefined) {
      config.host = next;
      index += 1;
    } else if (flag === "--port" && next !== undefined && Number.isInteger(Number(next))) {
      config.port = Number(next);
      index += 1;
    } else {
      console.error(USAGE);
      process.exit(1);
    }
  }
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    console.error(`Invalid port: ${String(process.env.MCP_PORT)}`);
    process.exit(1);
  }
  return config;
}

const config = parseArguments(process.argv);

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const runtime: McpRuntime = createMcpRuntime({ databaseUrl });

async function runStdio(): Promise<void> {
  const server = createMcpServer(runtime.dependencies);
  await server.connect(new StdioServerTransport());
  // Logs must go to stderr so the stdio JSON-RPC stream stays clean.
  console.error("[mcp-server] stdio transport ready");
}

/**
 * Stateless Streamable HTTP: one transport + server instance per request, no
 * session id. Matches the SDK's documented stateless pattern and keeps the
 * process horizontally scalable behind a load balancer.
 */
function buildHttpApp(): Express {
  const app = createMcpExpressApp({ host: config.host });
  app.use(express.json());

  const mount = async (req: Request, res: Response): Promise<void> => {
    const server = createMcpServer(runtime.dependencies);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", (req, res) => void mount(req, res));
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed", hint: "Stateless server: POST JSON-RPC to /mcp" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed", hint: "Stateless server: no sessions to delete" });
  });

  return app;
}

async function runHttp(): Promise<void> {
  const app = await buildHttpApp();
  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`[mcp-server] streamable HTTP listening on http://${config.host}:${config.port}/mcp`);
  });

  const shutdown = (signal: string) => {
    console.log(`[mcp-server] received ${signal}, shutting down`);
    httpServer.close(() => {
      void runtime.stop().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (config.transport === "http") {
  await runHttp();
} else {
  await runStdio();
  const shutdown = (signal: string) => {
    console.error(`[mcp-server] received ${signal}, shutting down`);
    void runtime.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
