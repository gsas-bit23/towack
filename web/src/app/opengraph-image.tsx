import { ImageResponse } from "next/og";

export const alt = "Towack — Arcade Sky on BNB Smart Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          padding: "56px 64px",
          background: "#1FC6F2",
          color: "#13204A",
          border: "16px solid #13204A",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              background: "#13204A",
              color: "#FFFFFF",
              padding: "12px 28px",
              borderRadius: "999px",
              fontSize: "24px",
              fontWeight: 800,
            }}
          >
            <span style={{ color: "#FFCD2E" }}>●</span>
            <span>TOWACK (TWAK) · BNB SMART CHAIN</span>
          </div>
          <div
            style={{
              background: "#FFCD2E",
              border: "5px solid #13204A",
              borderRadius: "999px",
              padding: "10px 24px",
              fontSize: "22px",
              fontWeight: 900,
            }}
          >
            CHAINLINK VRF v2.5
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div
            style={{
              fontSize: "84px",
              fontWeight: 900,
              lineHeight: 0.96,
              color: "#FFFFFF",
              textShadow: "0 8px 0 #13204A",
            }}
          >
            Step right up. Grab your slot.
          </div>
          <div style={{ fontSize: "30px", fontWeight: 700, color: "#13204A", maxWidth: "960px" }}>
            5,000 Agent ID slots · 0.1 BNB mint · 80,000 TWAK instantly + instant per-mint prize wheel · Open Draw V2 &amp; PancakeSwap v2 router.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "16px" }}>
            <div style={{ background: "#FFFFFF", border: "4px solid #13204A", borderRadius: "20px", padding: "12px 22px", fontSize: "22px", fontWeight: 800 }}>
              Genesis 300 Free
            </div>
            <div style={{ background: "#FF4FA3", color: "#FFFFFF", border: "4px solid #13204A", borderRadius: "20px", padding: "12px 22px", fontSize: "22px", fontWeight: 800 }}>
              5% Referrals
            </div>
            <div style={{ background: "#FFCD2E", border: "4px solid #13204A", borderRadius: "20px", padding: "12px 22px", fontSize: "22px", fontWeight: 800 }}>
              Agent ID Rebates
            </div>
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#13204A" }}>Game of chance, not an investment.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
