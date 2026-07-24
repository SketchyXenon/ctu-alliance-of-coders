import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Alliance of Coders - CTU Danao Campus";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Site URL from env (single source of truth). Falls back to localhost in dev.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

/**
 * Dynamic Open Graph image at /opengraph-image.
 * Renders the brand name on a navy background with gold accent.
 */
export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #01081e 0%, #020d30 50%, #04194f 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 32,
          }}
        >
          <img
            src={`${siteUrl}/logo.png`}
            width={120}
            height={120}
            alt=""
            style={{ borderRadius: 16 }}
          />
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.03em",
          }}
        >
          Alliance of <span style={{ color: "#d4a017", marginLeft: 16 }}>Coders</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 32,
            color: "#93aee8",
            marginTop: 16,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          CTU Danao Campus
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            padding: "12px 32px",
            borderRadius: 999,
            background: "rgba(212, 160, 23, 0.15)",
            border: "1px solid rgba(212, 160, 23, 0.4)",
            fontSize: 22,
            color: "#eacc72",
          }}
        >
          Developers . Innovators . Tech Leaders
        </div>
      </div>
    ),
    size
  );
}
