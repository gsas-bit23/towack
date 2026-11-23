import { ImageResponse } from "next/og";

export const alt = "Towack — Agent ID markets on BNB Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const chip = { display: "flex", border: "1px solid #2E353F", borderRadius: "999px", padding: "10px 20px", fontSize: "22px", color: "#B7BDC6" } as const;

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
          padding: "64px 72px",
          background: "radial-gradient(circle at 92% 8%, rgba(240,185,11,.18), rgba(11,14,17,0) 45%), #0B0E11",
          color: "#EAECEF",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "34px", fontWeight: 700 }}>
            <div style={{ display: "flex", width: "40px", height: "40px", borderRadius: "999px", border: "4px solid #2E353F", borderTopColor: "#F0B90B", borderRightColor: "#F0B90B" }} />
            Towack
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "22px", color: "#B7BDC6" }}>
            <div style={{ display: "flex", width: "10px", height: "10px", borderRadius: "999px", background: "#F0B90B" }} />
            BSC · BNB Smart Chain
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: "76px", fontWeight: 700, lineHeight: 1.04, letterSpacing: "-2px" }}>
            Towack — Agent ID markets&nbsp;<span style={{ color: "#8B94A3", fontWeight: 500 }}>on BNB Chain.</span>
          </div>
          <div style={{ fontSize: "28px", color: "#B7BDC6", maxWidth: "980px" }}>
            5,000 Agent ID slots · 0.1 BNB mint · 80,000 TWAK instantly + a Chainlink VRF prize wheel · open Draw V2 and router.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ ...chip, borderColor: "rgba(240,185,11,.45)", color: "#F0B90B" }}>Genesis 300 Free</div>
            <div style={chip}>5% Referrals</div>
            <div style={chip}>Agent ID Rebates</div>
          </div>
          <div style={{ fontSize: "20px", color: "#6B7380" }}>Game of chance, not an investment.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
