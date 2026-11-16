import type { MetadataRoute } from "next";

/** Installation sur l'écran d'accueil (iPhone : Partager → « Sur l'écran d'accueil »). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stage Tracker",
    short_name: "Stages",
    description: "Suivi de mes candidatures de stage",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "fr",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
