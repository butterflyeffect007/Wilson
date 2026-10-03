/**
 * AdapterRegistry — maps provider/model pairs to concrete ModelAdapter instances.
 *
 * Keeps provider selection out of the UI and out of the router.
 * The router asks the registry for the preferred engine; the registry
 * returns the adapter or undefined if it isn't registered.
 */

import type { ModelAdapter } from "./";

export class AdapterRegistry {
  private adapters = new Map<string, ModelAdapter>();

  register(provider: string, model: string, adapter: ModelAdapter): void {
    this.adapters.set(`${provider}::${model}`, adapter);
  }

  get(provider: string, model: string): ModelAdapter | undefined {
    return this.adapters.get(`${provider}::${model}`);
  }

  has(provider: string, model: string): boolean {
    return this.adapters.has(`${provider}::${model}`);
  }
}

export default AdapterRegistry;