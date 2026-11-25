import { zeroAddress, type Address } from "viem";

/**
 * Agent Exchange sign-in message (EIP-712), shared by the browser (wagmi signTypedData), the server (signature
 * recovery) and the AI-agent instructions (BAW `sign-message`). Same domain shape BAW already signs for Aster.
 */
export const SIGN_IN_STATEMENT = "Sign in to the Towack Agent Exchange. This signature cannot move funds.";

export const SIGN_IN_TYPES = {
  SignIn: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
} as const;

export const SIGN_IN_DOMAIN = { name: "Towack Agent Exchange", version: "1", chainId: 56, verifyingContract: zeroAddress } as const;

export type SignInMessage = { wallet: Address; nonce: string; issuedAt: string; statement: string };

/** Full EIP-712 payload as JSON (what `baw sign-message preview --message` wraps in eth_signTypedData_v4). */
export function signInTypedDataJson(m: SignInMessage): string {
  return JSON.stringify({
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...SIGN_IN_TYPES,
    },
    primaryType: "SignIn",
    domain: SIGN_IN_DOMAIN,
    message: m,
  });
}
