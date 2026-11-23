# Towack web (Atlas)

Next.js App Router frontend for Towack. wagmi + viem + RainbowKit, Tailwind v4.

```sh
npm i
cp .env.example .env.local   # optional; fill NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
npm run dev                  # http://localhost:3000
npm run build && npm start
npm run lint
npm run abi                  # forge build + re-export ABIs into src/abi/
```

- Addresses: `src/config/addresses.json` (by chain id), overridable via `NEXT_PUBLIC_TOWACK_<chain>_<KEY>`.
  Empty Towack addresses show a "Contracts deploying soon" state and skip reads/writes.
- Wallets: injected always. Binance Wallet + WalletConnect when a WalletConnect project id is set.
  Without it, Binance Wallet still works as an injected wallet (extension or Binance app browser).
- Every Towack contract write (mint, draw, router, rebates, referrals, claims) opens in the user's
  connected wallet and waits for confirmation. There is no server wallet and the site never asks for
  seed phrases.
- Exception, Aster perps (`/perps`): after the user explicitly sets up a trade-only Aster API wallet
  (generated in the browser and approved with `canWithdraw=false`, or pasted), its key is stored in
  this browser (localStorage or sessionStorage) and signs Aster order / cancel / leverage / margin
  requests with no per-order wallet popup. The user can forget the key on `/perps`.
- Swap quotes come from public, keyless APIs (PancakeSwap, Uniswap, Relay). 0x / 1inch stay off unless
  `NEXT_PUBLIC_ZEROX_API_KEY` / `NEXT_PUBLIC_ONEINCH_API_KEY` is set. Swaps execute from the user's
  wallet (or the documented Binance Agentic Wallet path), never a Towack server signer.
- `src/stubs/` aliases unused optional `@x402/*` deps pulled in transitively by wagmi's Coinbase
  connector (see `next.config.ts`) so Turbopack builds cleanly.
