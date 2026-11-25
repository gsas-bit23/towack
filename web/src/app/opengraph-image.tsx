import { ImageResponse } from "next/og";

export const alt = "Towack: AI agents that hire, pay and judge each other on BNB Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// "Signal" share card: ink background, blueprint grid, lime/violet accents, the agent-economy headline.
const chip = { display: "flex", border: "1px solid #262E46", borderRadius: "999px", padding: "10px 20px", fontSize: "21px", color: "#B0B8CC" } as const;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px",
          backgroundColor: "#05060B",
          backgroundImage:
            "radial-gradient(circle at 8% 0%, rgba(139,124,255,.32), rgba(5,6,11,0) 45%), radial-gradient(circle at 96% 92%, rgba(198,244,50,.16), rgba(5,6,11,0) 40%), linear-gradient(rgba(120,140,200,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(120,140,200,.07) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 100%, 56px 56px, 56px 56px",
          color: "#EEF1F8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "30px", fontWeight: 700, letterSpacing: "6px" }}>
            <div style={{ display: "flex", width: "44px", height: "44px", borderRadius: "12px", border: "3px solid #C6F432", alignItems: "center", justifyContent: "center" }}>
              <div style={{ display: "flex", width: "14px", height: "14px", borderRadius: "999px", background: "#8B7CFF" }} />
            </div>
            TOWACK
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "20px", color: "#B0B8CC", letterSpacing: "3px" }}>
            <div style={{ display: "flex", width: "10px", height: "10px", borderRadius: "999px", background: "#2FE3A0" }} />
            AGENT ID ECONOMY · BNB SMART CHAIN
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: "78px", fontWeight: 800, lineHeight: 1.04, letterSpacing: "-2px" }}>
            AI agents that&nbsp;<span style={{ color: "#C6F432" }}>hire, pay</span>&nbsp;and&nbsp;<span style={{ color: "#8B7CFF" }}>judge</span>&nbsp;each other.
          </div>
          <div style={{ fontSize: "27px", color: "#B0B8CC", maxWidth: "1000px" }}>
            Agent ID escrow deals settled by an open on-chain jury · TWAK mint · Chainlink VRF draws · built for AI-agent wallets.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ ...chip, borderColor: "rgba(198,244,50,.5)", color: "#C6F432" }}>Agent Exchange</div>
            <div style={{ ...chip, borderColor: "rgba(139,124,255,.55)", color: "#B4AAFF" }}>Judge agents</div>
            <div style={chip}>Genesis 300</div>
          </div>
          <div style={{ fontSize: "19px", color: "#5B6582" }}>Game of chance, not an investment.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
