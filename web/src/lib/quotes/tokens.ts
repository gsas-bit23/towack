import { getAddress, zeroAddress, type Address } from "viem";
import type { Token } from "./types";

/** Native coin marker (Relay's convention). */
export const NATIVE: Address = zeroAddress;
/** Native coin marker used by 0x / 1inch. */
export const EEEE: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const isNative = (t: Pick<Token, "address">) => t.address.toLowerCase() === NATIVE;
export const sameToken = (a: Token, b: Token) => a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();

const tk = (chainId: number, address: string, symbol: string, name: string, decimals = 18): Token => ({
  chainId,
  address: address === NATIVE ? NATIVE : getAddress(address),
  symbol,
  name,
  decimals,
});

/**
 * Per-chain on-chain venues. Every address below was checked on-chain (eth_getCode + a live quote) on 2026-11-23.
 * Uniswap v3 has no BSC-testnet deployment; Relay has no BSC-testnet support (its testnet API lists only Sepolia / Base Sepolia).
 */
export type ChainVenues = {
  wrappedNative: Address;
  pancakeV2?: { router: Address };
  pancakeV3?: { quoter: Address; router: Address; fees: number[] };
  uniswapV3?: { quoter: Address; router: Address; fees: number[] };
};

export const VENUES: Record<number, ChainVenues> = {
  56: {
    wrappedNative: getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
    pancakeV2: { router: getAddress("0x10ED43C718714eb63d5aA57B78B54704E256024E") },
    // QuoterV2 + SmartRouter (IV3SwapRouter interface, same calldata shape as Uniswap SwapRouter02)
    pancakeV3: {
      quoter: getAddress("0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997"),
      router: getAddress("0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"),
      fees: [100, 500, 2500, 10000],
    },
    uniswapV3: {
      quoter: getAddress("0x78D78E420Da98ad378D7799bE8f4AF69033EB077"),
      router: getAddress("0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2"), // SwapRouter02
      fees: [100, 500, 3000, 10000],
    },
  },
  97: {
    wrappedNative: getAddress("0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"),
    pancakeV2: { router: getAddress("0xD99D1c33F9fC3444f8101754aBC46c52416550D1") },
    pancakeV3: {
      quoter: getAddress("0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2"),
      router: getAddress("0x9a489505a00cE272eAa5e07Dba6491314CaE3796"),
      fees: [100, 500, 2500, 10000],
    },
  },
};

/** Origin-chain token lists (the chain the user signs on). WBNB is left out on purpose: wrapping is not a swap. */
export const ORIGIN_TOKENS: Record<number, Token[]> = {
  56: [
    tk(56, NATIVE, "BNB", "BNB"),
    tk(56, "0x55d398326f99059fF775485246999027B3197955", "USDT", "Tether USD (BSC)"),
    tk(56, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "USDC", "USD Coin (BSC)"),
    tk(56, "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", "ETH", "Ethereum (BSC peg)"),
    tk(56, "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", "BTCB", "Bitcoin (BSC peg)"),
    tk(56, "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "CAKE", "PancakeSwap"),
  ],
  97: [
    tk(97, NATIVE, "tBNB", "Test BNB"),
    tk(97, "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", "USDT", "Test USDT (PancakeSwap testnet)"),
  ],
};

export type DestChain = { id: number; name: string; short: string; tokens: Token[] };

/** Cross-chain destinations quoted through Relay (EVM only, so the recipient can be the same address). */
export const RELAY_DESTINATIONS: DestChain[] = [
  { id: 1, name: "Ethereum", short: "ETH", tokens: [tk(1, NATIVE, "ETH", "Ether"), tk(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin", 6)] },
  { id: 8453, name: "Base", short: "Base", tokens: [tk(8453, NATIVE, "ETH", "Ether"), tk(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USD Coin", 6)] },
  { id: 42161, name: "Arbitrum", short: "Arb", tokens: [tk(42161, NATIVE, "ETH", "Ether"), tk(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USDC", "USD Coin", 6)] },
  { id: 10, name: "Optimism", short: "OP", tokens: [tk(10, NATIVE, "ETH", "Ether"), tk(10, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "USDC", "USD Coin", 6)] },
  { id: 137, name: "Polygon", short: "POL", tokens: [tk(137, NATIVE, "POL", "POL"), tk(137, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "USDC", "USD Coin", 6)] },
];

export const CHAIN_NAMES: Record<number, string> = {
  56: "BNB Chain",
  97: "BSC Testnet",
  ...Object.fromEntries(RELAY_DESTINATIONS.map((c) => [c.id, c.name])),
};

export function makeToken(chainId: number, address: Address, symbol: string, name: string, decimals = 18): Token {
  return tk(chainId, address, symbol, name, decimals);
}

/** Wrapped-native address on `chainId` (for AMM paths), or undefined if we have no venues there. */
export function wrappedNative(chainId: number): Address | undefined {
  return VENUES[chainId]?.wrappedNative;
}

/** True for the native coin or its wrapped ERC-20 on the same chain (both price 1:1 against native gas). */
export function isNativeLike(t: Token): boolean {
  const w = wrappedNative(t.chainId);
  return isNative(t) || (w !== undefined && t.address.toLowerCase() === w.toLowerCase());
}
