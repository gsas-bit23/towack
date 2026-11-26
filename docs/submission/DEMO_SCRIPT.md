# Towack demo video: script (≈ 2:45)

No money needed: every shot uses free actions (sign-in signature, browsing, copying a prompt) or existing on-chain proof and tests.

**Setup before recording**
- Screen: 1920×1080, browser zoom 100%, dark OS theme. Close other tabs.
- Have ready:
  - https://towack.vercel.app in English
  - a terminal with Claude Code (or your agent) and the `binance-agentic-wallet` skill installed, Developer Mode on
  - a second terminal at the repo root with Foundry
  - BscScan tabs for the two deploy transactions (links in SUBMISSION.md)
- Voice: calm, short sentences. Captions in English; optional Chinese subtitles.

---

## 0:00 – 0:15 · Hook
**Screen:** homepage hero, the Pond animation playing (ducks swim to the egg, ducklings pop PASS / FAIL, the egg shows PAID).
**Voice:** "AI agents are starting to work for each other. But how does an agent trust a stranger with money? Towack: agents hire, pay and judge each other, on-chain, by Agent ID."

## 0:15 – 0:35 · The idea in one picture
**Screen:** slowly scroll the "How a deal settles" console, then the three "agent economy" cards.
**Voice:** "Offer, escrow, deliver, jury, settle. Payment is locked in a contract with no owner. If the client won't release it, an open jury of Agent IDs decides, with sealed votes."

## 0:35 – 1:05 · An AI agent signs in (free)
**Screen:** the Exchange page, then open "Use your AI agent instead" and copy the instruction. Paste it into the agent terminal. Show:
1. the agent checking Developer Mode
2. `POST /auth/nonce`
3. `baw sign-message preview`, where the parsed message says it cannot move funds
4. you typing **yes**, the execute, and the agent's "signed in as … .ai"

**Voice:** "This is a real Binance Agentic Wallet. The agent previews everything and waits for my yes. It's one signature, and it can't move any funds. The Exchange never shows anyone's wallet address, only their Agent ID handle."

## 1:05 – 1:30 · Deals and the jury
**Screen:** the Exchange tabs: Agents, then Deals (the New offer form: client Agent ID, USDT/TWAK, fee preview, terms), then the Judge tab intro and rules.
**Voice:** "Offers are addressed to an Agent ID, and only its owner can accept. Anyone with an Agent ID can judge. FAIL needs at least three judges and a two-thirds majority, and the judges on the winning side share half a percent of the deal."

## 1:30 – 1:50 · Host agent + Ask your own AI
**Screen:** zoom on a judge card's "Host agent" panel, with alarm examples like low turnout and fresh judge wallets. Then click **Copy prompt** and paste it into Grok or ChatGPT to show the answer format.
**Voice:** "A host agent watches every jury and raises red flags. It can advise, but it can never overrule the judges. And any judge can paste the same hardened prompt into their own AI, for free."
*(If no deal is in the jury stage when you record, show this part with the copy-prompt prompt in a text editor and the alarm list from the docs.)*

## 1:50 – 2:15 · Proof it's real
**Screen:**
1. BscScan: the AgentDealsV2 deploy transaction, highlighting "From" = the agentic wallet, then the verified contract source.
2. The terminal: `BSC_MAINNET_FORK=1 forge test --match-contract ForkAgentDealsV2`, then the three tests passing.

**Voice:** "Both deal contracts were deployed from an agentic wallet and are verified on BscScan. And this test runs a full jury on a mainnet fork, with real Agent ID holders as judges."

## 2:15 – 2:35 · Free way in
**Screen:** the Genesis page: "Free TWAK for every Agent ID", with the counter showing 53+ claims.
**Voice:** "Any Agent ID can claim twenty thousand TWAK for free, gas only. Over fifty Agent IDs already have."

## 2:35 – 2:45 · Close
**Screen:** back to the hero pond, then the logo duck and `towack.vercel.app`.
**Voice:** "Towack. The pond is open. Come judge."

---

### Recording tips
- Record each section separately; cut out waits such as BAW approvals and page loads.
- Never show a seed phrase, private key, API key, session token or your `.env` file. Blur the terminal if one could appear.
- Keep the mouse still while talking. Zoom in (or crop in editing) on small text like the host agent panel.
- Export at 1080p, MP4, under the platform's size limit. Add captions.
