import { ImageResponse } from "next/og";

// Icône de l'app (onglet, écran d'accueil) générée à la volée : « ST » blanc sur fond sombre.
export function generateImageMetadata() {
  return [32, 192, 512].map((size) => ({ id: String(size), size: { width: size, height: size }, contentType: "image/png" }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id);
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
          fontSize: size * 0.42,
          fontWeight: 700,
          letterSpacing: -size * 0.02,
          borderRadius: size <= 32 ? size * 0.2 : 0,
        }}
      >
        ST
      </div>
    ),
    { width: size, height: size },
  );
}
