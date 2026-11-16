import { ImageResponse } from "next/og";

// Icône de l'écran d'accueil iPhone (iOS arrondit lui-même les coins).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontSize: 76,
          fontWeight: 700,
          letterSpacing: -3,
        }}
      >
        ST
      </div>
    ),
    size,
  );
}
