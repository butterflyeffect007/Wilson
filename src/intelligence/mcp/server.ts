/**
 * Wilson MCP Server
 *
 * Exposes Wilson-specific tools over the Model Context Protocol
 * (Streamable HTTP). Run standalone so any MCP client (including
 * Wilson's own McpGateway or an external agent) can call them.
 *
 * Start: npm run mcp:server
 * Endpoint: http://localhost:3001/mcp
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/streamableHttp";
import express from "express";
import * as z from "zod/v4";

export function createWilsonMcpServer() {
  const server = new McpServer({
    name: "wilson",
    version: "1.0.0",
  });

  // --- Companion / brand tools ---

  server.registerTool(
    "wilson:reflect",
    {
      description: "Quiet reflection prompt. Returns a short, calm observation Wilson can surface.",
      inputSchema: z.object({
        topic: z.string().describe("What the user is thinking about"),
      }),
    },
    async ({ topic }) => ({
      content: [
        {
          type: "text",
          text: `Wilson notes: the idea of "${topic}" is still open. Possibility first, structure later.`,
        },
      ],
    }),
  );

  server.registerTool(
    "wilson:palette",
    {
      description: "Return Wilson's current brand tokens (void, pearl, ice, lattice, ink).",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              void: "#07080c",
              pearl: "#9ec9d4",
              ice: "#d7e6ee",
              lattice: "#7aa8b4",
              ink: "#e8eef0",
              hairline: "#1c2228",
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "wilson:status",
    {
      description: "Report a short operational status of the Wilson MCP server.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              server: "wilson",
              version: "1.0.0",
              tools: ["wilson:reflect", "wilson:palette", "wilson:status", "wilson:imagine"],
              ready: true,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "wilson:imagine",
    {
      description: "Light creative prompt expansion. Turns a short idea into a slightly richer starting point without leaving Wilson's tone.",
      inputSchema: z.object({
        seed: z.string().describe("Short idea or phrase to expand"),
      }),
    },
    async ({ seed }) => ({
      content: [
        {
          type: "text",
          text: `Wilson imagines: starting from "${seed}", the next useful move is to make one concrete piece of it visible — a name, a color, a single interaction — then decide if it belongs in the void.`,
        },
      ],
    }),
  );

  return server;
}

// --- Standalone entry ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createWilsonMcpServer();
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport("/mcp", res);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  const PORT = Number(process.env.PORT ?? 3001);
  app.listen(PORT, () => {
    console.log(`Wilson MCP server listening on http://localhost:${PORT}/mcp`);
  });
}
