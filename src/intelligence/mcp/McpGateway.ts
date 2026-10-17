/**
 * MCP Gateway for Wilson.
 *
 * Sits between the IntelligenceRouter / tool step and one or more remote
 * Model Context Protocol servers (Streamable HTTP). Aggregates their tools
 * into a single list the agent can use, and normalizes call results into
 * the same shape Wilson's existing ToolResult uses.
 *
 * Does not replace the built-in public-data tools. It is an additional
 * translation layer so Wilson can talk to any MCP server without custom
 * glue for each one.
 */

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export interface McpServerConfig {
  /** Stable id used in tool namespacing, e.g. "postgres" or "wilson-internal" */
  id: string;
  /** Full URL of the MCP endpoint, e.g. "http://localhost:3000/mcp" */
  url: string;
  /** Optional headers (auth, etc.) */
  headers?: Record<string, string>;
}

export interface McpTool {
  /** Namespaced name: "serverId:toolName" */
  name: string;
  serverId: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  text: string;
  structured?: unknown;
  error?: string;
}

interface Connected {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: McpTool[];
}

export class McpGateway {
  private servers = new Map<string, Connected>();

  constructor(private readonly configs: McpServerConfig[]) {}

  /** Connect to every configured server and cache their tool lists. */
  async connect(): Promise<void> {
    await Promise.all(
      this.configs.map(async (cfg) => {
        const client = new Client({ name: "wilson", version: "1.0.0" });
        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
        });
        await client.connect(transport);
        const listed = await client.listTools();
        const tools: McpTool[] = (listed.tools ?? []).map((t) => ({
          name: `${cfg.id}:${t.name}`,
          serverId: cfg.id,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }));
        this.servers.set(cfg.id, { client, transport, tools });
      }),
    );
  }

  /** Flat list of every tool from every connected server. */
  listTools(): McpTool[] {
    return [...this.servers.values()].flatMap((s) => s.tools);
  }

  /**
   * Call a namespaced tool ("serverId:toolName").
   * Returns a normalized result that can be folded into Wilson's tool context.
   */
  async call(namespaced: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    const [serverId, ...rest] = namespaced.split(":");
    const toolName = rest.join(":");
    const conn = this.servers.get(serverId);
    if (!conn) return { ok: false, text: "", error: `Unknown MCP server: ${serverId}` };

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args });
      const content = result.content ?? [];
      const text = content
        .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");
      return {
        ok: !result.isError,
        text,
        structured: (result as { structuredContent?: unknown }).structuredContent,
        error: result.isError ? text : undefined,
      };
    } catch (e) {
      return { ok: false, text: "", error: String((e as Error)?.message ?? e) };
    }
  }

  /** Close every connection. */
  async close(): Promise<void> {
    await Promise.all([...this.servers.values()].map((s) => s.client.close().catch(() => {})));
    this.servers.clear();
  }
}

/**
 * Convenience: turn an MCP result into the same shape Wilson's ToolResult
 * expects so it can be dropped into the existing tool-step context.
 */
export function toWilsonToolResult(name: string, result: McpCallResult) {
  return {
    name,
    ok: result.ok,
    data: result.structured ?? { text: result.text },
    sources: [] as { title: string; url: string }[],
    error: result.error,
  };
}
