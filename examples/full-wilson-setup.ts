/**
 * Complete end-to-end example: OmniRoute gateway + Wilson MCP server.
 *
 * Prerequisites:
 *   1. OmniRoute running on :20128 (see README)
 *   2. Wilson MCP server: npm run mcp:server
 *
 * Then in your app bootstrap:
 */

import { setupWilsonIntelligence } from "../src/intelligence/setup";
import { IntelligenceRouter } from "../src/intelligence/IntelligenceRouter";

export async function bootFullWilson() {
  const { registry, policy, mcp } = await setupWilsonIntelligence({
    policy: {
      preferredEngine: {
        provider: "omniroute",
        model: "auto/best-coding",
      },
    },
    omniroute: {
      baseUrl: process.env.OMNIROUTE_URL ?? "http://localhost:20128",
      apiKey: process.env.OMNIROUTE_API_KEY ?? "",
      defaultModel: "auto/best-coding",
    },
    mcp: [
      {
        id: "wilson",
        url: process.env.WILSON_MCP_URL ?? "http://localhost:3001/mcp",
      },
    ],
  });

  const router = new IntelligenceRouter(policy, registry);

  return {
    router,
    mcp,
    // Convenience: list MCP tools Wilson can now call
    mcpTools: mcp?.listTools() ?? [],
  };
}
