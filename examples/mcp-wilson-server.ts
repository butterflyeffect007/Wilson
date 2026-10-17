/**
 * Thin launcher for the Wilson MCP server.
 *
 * Prefer: npm run mcp:server
 * This file remains for backward compatibility.
 */

import { createWilsonMcpServer } from "../src/intelligence/mcp/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/streamableHttp";
import express from "express";

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
