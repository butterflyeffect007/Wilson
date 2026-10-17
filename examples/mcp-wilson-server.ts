/**
 * Minimal Wilson-facing MCP server example.
 *
 * Run with: npx tsx examples/mcp-wilson-server.ts
 * Then point McpGateway at http://localhost:3001/mcp
 *
 * Exposes a couple of tools that fit Wilson's cosmic / companion character
 * without touching production data.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/streamableHttp";
import express from "express";
import * as z from "zod/v4";

const server = new McpServer({ name: "wilson-internal", version: "1.0.0" });

server.registerTool(
  "reflect",
  {
    description: "Quiet reflection prompt — returns a short, calm observation Wilson can use.",
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
  "palette",
  {
    description: "Return Wilson's current brand tokens (void, pearl, ice, lattice).",
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
          },
          null,
          2,
        ),
      },
    ],
  }),
);

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
