/** Wilson biometric unlock layer — public exports. See artifacts/biometric-unlock-architecture.md. */
export {
  BiometricGate, GateError, LocalStubProvider,
  type GateState, type GateMethod, type GateErrorCode, type BiometricGateOptions,
  type NativeBiometricProvider, type CredentialsLike,
} from "./biometric-gate";
export { KeyStore, MemoryBackend, IndexedDBBackend, type KeyStoreBackend, type SealedBlob } from "./key-store";

import { BiometricGate } from "./biometric-gate";

let shared: BiometricGate | null = null;
/** The one gate instance the app uses. */
export function getBiometricGate(): BiometricGate {
  if (!shared) shared = new BiometricGate();
  return shared;
}

/** Name the GitHub CLI token is sealed under (see "GitHub unlock flow" in the architecture doc). */
export const GITHUB_TOKEN_SECRET = "github-cli-token";
