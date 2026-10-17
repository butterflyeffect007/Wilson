/**
 * Open Quantum MCP Server for Wilson.
 *
 * Lets Wilson (or any MCP client) discover backends and submit circuits
 * on IonQ / Rigetti / IQM / AQT hardware via the Open Quantum platform.
 *
 * Credentials are read from the environment only — never hardcoded:
 *   OPENQUANTUM_CLIENT_ID
 *   OPENQUANTUM_CLIENT_SECRET
 *
 * Optional:
 *   OPENQUANTUM_API_BASE  (defaults to the public API)
 *
 * Start: npm run mcp:openquantum
 * Endpoint: http://localhost:3002/mcp
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/server/streamableHttp";
import express from "express";
import * as z from "zod/v4";

const API_BASE = process.env.OPENQUANTUM_API_BASE ?? "https://api.openquantum.com";

async function getToken(): Promise<string> {
  const clientId = process.env.OPENQUANTUM_CLIENT_ID;
  const clientSecret = process.env.OPENQUANTUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Set OPENQUANTUM_CLIENT_ID and OPENQUANTUM_CLIENT_SECRET");
  }

  // Open Quantum uses client-credentials flow (see their docs).
  // Adjust the token endpoint if their portal documents a different path.
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open Quantum auth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in Open Quantum response");
  return data.access_token;
}

async function api(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open Quantum ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function createOpenQuantumMcpServer() {
  const server = new McpServer({
    name: "openquantum",
    version: "1.0.0",
  });

  server.registerTool(
    "openquantum:providers",
    {
      description: "List available Open Quantum backends / providers (IonQ, Rigetti, IQM, AQT, etc.).",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await api("/v1/providers");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: String((e as Error).message) }], isError: true };
      }
    },
  );

  server.registerTool(
    "openquantum:organizations",
    {
      description: "List organizations visible to the authenticated Open Quantum account.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const data = await api("/v1/organizations");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: String((e as Error).message) }], isError: true };
      }
    },
  );

  server.registerTool(
    "openquantum:submit",
    {
      description: "Submit an OpenQASM circuit to Open Quantum. Returns the job id.",
      inputSchema: z.object({
        qasm: z.string().describe("OpenQASM 2.0 or 3.0 circuit"),
        backend: z.string().optional().describe("Backend short code or id (optional)"),
        shots: z.number().optional().default(1000),
      }),
    },
    async ({ qasm, backend, shots }) => {
      try {
        const data = await api("/v1/jobs", {
          method: "POST",
          body: JSON.stringify({
            circuit: qasm,
            backend,
            shots,
          }),
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: String((e as Error).message) }], isError: true };
      }
    },
  );

  server.registerTool(
    "openquantum:status",
    {
      description: "Check the status of an Open Quantum job by id.",
      inputSchema: z.object({
        jobId: z.string(),
      }),
    },
    async ({ jobId }) => {
      try {
        const data = await api(`/v1/jobs/${encodeURIComponent(jobId)}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: String((e as Error).message) }], isError: true };
      }
    },
  );

  return server;
}

// Standalone entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createOpenQuantumMcpServer();
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport("/mcp", res);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  const PORT = Number(process.env.PORT ?? 3002);
  app.listen(PORT, () => {
    console.log(`Open Quantum MCP server listening on http://localhost:${PORT}/mcp`);
    console.log("Set OPENQUANTUM_CLIENT_ID and OPENQUANTUM_CLIENT_SECRET before submitting jobs.");
  });
}
