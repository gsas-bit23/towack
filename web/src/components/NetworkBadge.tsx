/** Static network indicator: the app runs on BNB Smart Chain mainnet only. */
export function NetworkBadge({ className = "hidden md:flex" }: { className?: string }) {
  return (
    <div
      aria-label="Network: BNB Smart Chain"
      className={`h-9 items-center gap-1.5 rounded-full border border-line-2 px-3 text-[13px] font-medium text-fg ${className}`}
    >
      <span className="h-[7px] w-[7px] rounded-full bg-gold" aria-hidden="true" />
      BNB Chain
    </div>
  );
}
