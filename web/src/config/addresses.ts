import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import raw from "./addresses.json";

export const CONTRACT_KEYS = [
  "agentId",
  "token",
  "launch",
  "router",
  "rebateDistributor",
  "teamVesting",
  "drawV2", // DrawV2 instant pool wheel (live: VRF v2.5 wrapper, holds the ~70M, = Launch.drawV2Treasury())
  "drawV2Legacy", // old skeleton DrawV2 from the superseded mock-VRF stack (history only)
  "timelock",
  "wbnb",
  "pancakeRouter",
  "pancakeFactory",
  "genesis", // Genesis 300: flat 20,000 TWAK gas-only claim (no VRF). Mainnet: 0x5B3028454a628F73A5fe9198DE4fddefCC43c73A. Retired VRF v1: 0xD093745a1BB0Dc11D5Dc2ded64905a9D27f08038
  "genesisMock", // old Genesis on MockVRFCoordinator (closed; history only)
  "drawV2Mock", // old pool wheel on MockVRFCoordinator (5M locked, no withdraw; history only)
  "vrfCoordinator", // official Chainlink VRF v2.5 coordinator (reference only; the live stack calls the wrapper, no subscription)
  "vrfWrapper", // official Chainlink VRF v2.5 direct-funding wrapper (live stack: Launch + DrawV2; the old VRF Genesis also used it)
  "launchVrfMock", // MockVRFCoordinator from the superseded mock-VRF testnet Launch (history only)
  "agentDeals", // AgentDeals: Agent ID-to-Agent ID escrow (USDT/TWAK, 1% fee: 0.8% treasury, 0.2% Draw V2), no owner
  "agentDealsV2", // AgentDealsV2: same escrow + open Agent ID judges (sealed votes, +0.5% to winning judges), no owner
] as const;

/**
 * Non-address VRF metadata kept next to the address book (vrfSubId, vrfKeyHash). LEGACY: only describes the retired
 * subscription-model testnet deploy (that subscription was cancelled). The live wrapper-model contracts have no
 * subscription and their key hash lives on the wrapper; safe to drop.
 */
export const VRF_META: Record<56, { subId?: string; keyHash?: string }> = {
  56: { subId: str(56, "vrfSubId"), keyHash: str(56, "vrfKeyHash") },
};

function str(chainId: SupportedChainId, key: string): string | undefined {
  const v = (raw as Record<string, Record<string, string | undefined>>)[String(chainId)]?.[key];
  return v ? v : undefined;
}

export type ContractKey = (typeof CONTRACT_KEYS)[number];
export type SupportedChainId = 97 | 56;
export type AddressBook = Record<ContractKey, Address | undefined>;

// Next.js only inlines NEXT_PUBLIC_* vars that are referenced literally, so every override is spelled out.
// Mainnet (56) only: the 97 section of addresses.json is historical and never read at runtime.
const ENV_OVERRIDES: Record<56, Partial<Record<ContractKey, string | undefined>>> = {
  56: {
    agentId: process.env.NEXT_PUBLIC_TOWACK_56_AGENT_ID,
    token: process.env.NEXT_PUBLIC_TOWACK_56_TOKEN,
    launch: process.env.NEXT_PUBLIC_TOWACK_56_LAUNCH,
    router: process.env.NEXT_PUBLIC_TOWACK_56_ROUTER,
    rebateDistributor: process.env.NEXT_PUBLIC_TOWACK_56_REBATE_DISTRIBUTOR,
    teamVesting: process.env.NEXT_PUBLIC_TOWACK_56_TEAM_VESTING,
    drawV2: process.env.NEXT_PUBLIC_TOWACK_56_DRAW_V2,
    drawV2Legacy: process.env.NEXT_PUBLIC_TOWACK_56_DRAW_V2_LEGACY,
    timelock: process.env.NEXT_PUBLIC_TOWACK_56_TIMELOCK,
    genesis: process.env.NEXT_PUBLIC_TOWACK_56_GENESIS,
    agentDeals: process.env.NEXT_PUBLIC_TOWACK_56_AGENT_DEALS,
    agentDealsV2: process.env.NEXT_PUBLIC_TOWACK_56_AGENT_DEALS_V2,
  },
};

/** Returns a checksummed address, or undefined for empty / malformed / zero values. */
export function cleanAddress(value: string | undefined | null): Address | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!isAddress(v, { strict: false })) return undefined;
  const a = getAddress(v);
  return a === zeroAddress ? undefined : a;
}

const json = raw as Record<string, Partial<Record<ContractKey, string>>>;

function build(chainId: 56): AddressBook {
  const base = json[String(chainId)] ?? {};
  const env = ENV_OVERRIDES[chainId];
  const book = {} as AddressBook;
  for (const key of CONTRACT_KEYS) {
    book[key] = cleanAddress(env[key]) ?? cleanAddress(base[key]);
  }
  return book;
}

/** Runtime address book: BNB Smart Chain mainnet (56) only. The 97 section of addresses.json is history, never read. */
export const ADDRESSES: Record<56, AddressBook> = {
  56: build(56),
};
