/**
 * ERC-8004 ("Trustless Agents") Identity Registry on BNB Smart Chain mainnet (BNB Chain's agent registry).
 * Shared by the server (on-chain link checks) and the UI (badge links).
 */
export const ERC8004_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

/** Public page for an ERC-8004 agent token on BscScan. */
export const erc8004Url = (id: string) => `https://bscscan.com/nft/${ERC8004_IDENTITY_REGISTRY}/${id}`;
