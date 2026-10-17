/**
 * Example: point Wilson at a local OmniRoute gateway.
 *
 * 1. Start OmniRoute:
 *      docker run -d --name omniroute -p 20128:20128 \
 *        -e INITIAL_PASSWORD=$(openssl rand -base64 24) \
 *        -v omniroute-data:/app/data diegosouzapw/omniroute
 *
 * 2. Open http://localhost:20128 , set the admin password, create an API key,
 *    and connect providers (or use the free no-auth pools / Combos).
 *
 * 3. Use this adapter in Wilson:
 */

import { AdapterRegistry } from "../src/intelligence/AdapterRegistry";
import { OmniRouteAdapter } from "../src/intelligence/OmniRouteAdapter";

export function registerOmniRoute(registry: AdapterRegistry, apiKey?: string) {
  const adapter = new OmniRouteAdapter({
    baseUrl: process.env.OMNIROUTE_URL ?? "http://localhost:20128",
    apiKey: apiKey ?? process.env.OMNIROUTE_API_KEY ?? "",
    defaultModel: "auto/best-coding",
  });

  // Register a few common Combo aliases so the router can prefer them.
  registry.register("omniroute", "auto/best-coding", adapter);
  registry.register("omniroute", "auto/best-free", adapter);
  registry.register("omniroute", "auto/best", adapter);

  return adapter;
}
