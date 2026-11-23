"use client";

export const RISK_NOTE_BASE =
  "Towack is a game of chance, not an investment. No returns are promised. You can lose the BNB you pay to mint. Trading involves risk. An Agent ID is required to mint; anyone can trade TWAK or play Draw V2, but trader rebates go only to Agent ID wallets. Not affiliated with Binance, BNB Chain, PancakeSwap, Chainlink, or Aster. Contracts are open source.";

export const RISK_NOTE = RISK_NOTE_BASE;

export function RiskNote({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-card p-6 ${className}`}>
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.12em] text-gold">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
          <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        Plain-language risk note
      </div>
      <p className="text-[13.5px] leading-relaxed text-muted">
        {RISK_NOTE_BASE} Always verify contract addresses before signing.
      </p>
    </div>
  );
}
