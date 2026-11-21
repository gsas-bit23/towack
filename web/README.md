# Towack web (Arcade Sky)

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
- Every write goes through the user's wallet. No server wallet, no keys, no auto-sign.
- `src/stubs/` aliases unused optional `@x402/*` deps pulled in transitively by wagmi's Coinbase
  connector (see `next.config.ts`) so Turbopack builds cleanly.
