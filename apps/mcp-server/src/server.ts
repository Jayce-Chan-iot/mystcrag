import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpToolDependencies } from "./deps.js";
import { createMcpToolRegistrations } from "./tools.js";

export const MCP_SERVER_NAME = "mystcrag-knowledge";
export const MCP_SERVER_VERSION = "0.1.0";

/**
 * Transport-agnostic MCP server: registers the five knowledge/design tools
 * on the official SDK's McpServer. The same instance can be connected to a
 * stdio transport or a Streamable HTTP transport.
 */
export function createMcpServer(deps: McpToolDependencies): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Mystcrag crystal knowledge tools. All results are deterministic and " +
        "derive from the reviewed knowledge base and design engine; cultural " +
        "references are inspiration only, never medical or guaranteed-effect claims."
    }
  );

  for (const tool of createMcpToolRegistrations(deps)) {
    // The SDK parses raw arguments against inputSchema before invoking the
    // callback, so args already satisfy the tool's Zod schema here.
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (args) => {
        const payload = await tool.invoke(args);
        return payload as CallToolResult;
      }
    );
  }

  return server;
}
