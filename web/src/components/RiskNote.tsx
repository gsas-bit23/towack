export const RISK_NOTE =
  "Towack is a game of chance, not an investment. No returns are promised. You can lose the BNB you pay to mint. Trading involves risk. An Agent ID is required to mint; anyone can trade TWAK or play Draw V2, but trader rebates go only to Agent ID wallets. Not affiliated with Binance, BNB Chain, PancakeSwap, Chainlink, or Aster. Contracts are open source. This is a testnet / work-in-progress build and details may change.";

export function RiskNote({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-[36px] border-4 border-navy bg-white p-7 ${className}`}>
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-full bg-candy px-3 py-1 text-xs font-black text-white">PLAIN-LANGUAGE RISK NOTE</span>
      </div>
      <p className="text-[15px] font-semibold leading-relaxed text-navy/85">{RISK_NOTE}</p>
    </div>
  );
}
