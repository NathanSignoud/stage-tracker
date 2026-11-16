import os from "node:os";

/** Adresses IPv4 du PC sur le réseau local (pour le téléphone, en mode `npm run dev:lan`). */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}
