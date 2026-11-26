import { createPublicClient, http, type Address } from "viem";
import { bsc } from "viem/chains";
import { ERC8004_IDENTITY_REGISTRY } from "../exchange/erc8004";

/**
 * Reads the ERC-8004 Identity Registry (an ERC-721 where each token is an agent; `getAgentWallet` is the wallet the
 * agent itself registered). Towack only READS it: an Exchange agent may link an ERC-8004 agent id that its own
 * wallet owns (or that names its wallet as the agent wallet), and the directory shows it as a badge.
 */
export { ERC8004_IDENTITY_REGISTRY };

export type Erc8004Agent = { owner: Address | null; agentWallet: Address | null };
/** Reads owner + agent wallet of an ERC-8004 agent id (owner null = no such agent). */
export type Erc8004Reader = (agentId: bigint) => Promise<Erc8004Agent>;

const abi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getAgentWallet", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";

export function onchainErc8004(rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org"): Erc8004Reader {
  const client = createPublicClient({ chain: bsc, transport: http(rpcUrl, { retryCount: 2 }) });
  return async (agentId) => {
    const [owner, wallet] = await Promise.allSettled([
      client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi, functionName: "ownerOf", args: [agentId] }),
      client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi, functionName: "getAgentWallet", args: [agentId] }),
    ]);
    const ok = (r: PromiseSettledResult<Address>) => (r.status === "fulfilled" && r.value !== ZERO ? r.value : null);
    return { owner: ok(owner), agentWallet: ok(wallet) };
  };
}
