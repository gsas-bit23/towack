import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import raw from "./addresses.json";

export const CONTRACT_KEYS = [
  "agentId",
  "token",
  "launch",
  "router",
  "rebateDistributor",
  "teamVesting",
  "drawV2", // DrawV2 instant pool wheel (new stand-alone deploy)
  "drawV2Legacy", // old skeleton DrawV2: holds the 70M + TowackLaunch's immutable BNB treasury
  "timelock",
  "wbnb",
  "pancakeRouter",
  "pancakeFactory",
  "genesis", // Genesis 300 on the OFFICIAL Chainlink VRF v2.5 coordinator
  "genesisMock", // old Genesis on MockVRFCoordinator (closed; history only)
  "drawV2Mock", // old pool wheel on MockVRFCoordinator (5M locked, no withdraw; history only)
  "vrfCoordinator", // official Chainlink VRF v2.5 coordinator (Genesis + DrawV2)
  "launchVrfMock", // MockVRFCoordinator still used by the testnet TowackLaunch (owner-fulfilled)
] as const;

/** Non-address VRF metadata kept next to the address book (vrfSubId, vrfKeyHash). */
export const VRF_META: Record<SupportedChainId, { subId?: string; keyHash?: string }> = {
  97: { subId: str(97, "vrfSubId"), keyHash: str(97, "vrfKeyHash") },
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
const ENV_OVERRIDES: Record<SupportedChainId, Partial<Record<ContractKey, string | undefined>>> = {
  97: {
    agentId: process.env.NEXT_PUBLIC_TOWACK_97_AGENT_ID,
    token: process.env.NEXT_PUBLIC_TOWACK_97_TOKEN,
    launch: process.env.NEXT_PUBLIC_TOWACK_97_LAUNCH,
    router: process.env.NEXT_PUBLIC_TOWACK_97_ROUTER,
    rebateDistributor: process.env.NEXT_PUBLIC_TOWACK_97_REBATE_DISTRIBUTOR,
    teamVesting: process.env.NEXT_PUBLIC_TOWACK_97_TEAM_VESTING,
    drawV2: process.env.NEXT_PUBLIC_TOWACK_97_DRAW_V2,
    drawV2Legacy: process.env.NEXT_PUBLIC_TOWACK_97_DRAW_V2_LEGACY,
    timelock: process.env.NEXT_PUBLIC_TOWACK_97_TIMELOCK,
    genesis: process.env.NEXT_PUBLIC_TOWACK_97_GENESIS,
  },
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

function build(chainId: SupportedChainId): AddressBook {
  const base = json[String(chainId)] ?? {};
  const env = ENV_OVERRIDES[chainId];
  const book = {} as AddressBook;
  for (const key of CONTRACT_KEYS) {
    book[key] = cleanAddress(env[key]) ?? cleanAddress(base[key]);
  }
  return book;
}

export const ADDRESSES: Record<SupportedChainId, AddressBook> = {
  97: build(97),
  56: build(56),
};
