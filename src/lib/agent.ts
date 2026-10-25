/**
 * Silver Harbor agent client.
 * Lets Wilson start/stop/status the live Ethereum observation stack
 * running on the Windows machine via Tailscale.
 *
 * Agent must be running on the SilverHarbor box:
 *   node agent.cjs
 * and Tailscale must be connected.
 */

const AGENT_URL = "http://100.117.181.95:3001/cmd";
const AGENT_SECRET = "wilson-secret-change-me";

export interface AgentResponse {
  status?: string;
  pid?: number;
  error?: string;
  running?: string[];
}

export async function wilsonCmd(
  action: "start" | "stop" | "status",
  target?: "connector" | "evaluator"
): Promise<AgentResponse> {
  const res = await fetch(AGENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret": AGENT_SECRET,
    },
    body: JSON.stringify({ action, target }),
  });

  if (!res.ok) {
    throw new Error(`Agent error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

// Convenience wrappers
export const startConnector = () => wilsonCmd("start", "connector");
export const startEvaluator = () => wilsonCmd("start", "evaluator");
export const stopConnector = () => wilsonCmd("stop", "connector");
export const stopEvaluator = () => wilsonCmd("stop", "evaluator");
export const agentStatus = () => wilsonCmd("status");
