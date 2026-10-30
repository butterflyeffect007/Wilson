export interface TransactionIntent {
  idempotencyKey?: string;
  nonce: number;
  timestamp?: number;
  expiry?: number;
  expiresAt?: number;
  sourceChain?: string;
  destinationChain?: string;
  destinationAddress?: string;
  chain?: string;
  tokenMint: string;
  amount: string;
  slippage?: number;
  maxSlippageBps?: number;
  [key: string]: unknown;
}

export interface SignerRecord {
  publicKey: string;
  revoked: boolean;
  weight: number;
  [key: string]: unknown;
}

export interface SignatureBundle {
  signerPublicKey: string;
  signature: string;
  [key: string]: unknown;
}

export interface VerificationResult {
  success: boolean;
  error?: string;
  verifiedIntent?: TransactionIntent;
  valid?: boolean;
  reason?: string;
  approvedSigners?: string[];
}

export type AuthorizedSignerRegistry =
  | Map<string, SignerRecord>
  | Record<string, SignerRecord>;
