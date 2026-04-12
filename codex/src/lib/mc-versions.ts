/** Mod loaders supported in the studio header (order = UI order). */
export const LOADERS_MOD = ["Fabric", "Forge", "NeoForge"] as const;
export type ModLoader = (typeof LOADERS_MOD)[number];

/**
 * Minecraft versions offered per loader / target.
 * Curated from common Fabric / Forge / NeoForge / Paper release lines (not every historical snapshot).
 */
export const MC_VERSIONS_BY_LOADER: Record<ModLoader, string[]> = {
  Fabric: [
    "1.21.5",
    "1.21.4",
    "1.21.3",
    "1.21.2",
    "1.21.1",
    "1.21",
    "1.20.6",
    "1.20.5",
    "1.20.4",
    "1.20.3",
    "1.20.2",
    "1.20.1",
    "1.19.4",
    "1.19.3",
    "1.19.2",
    "1.19.1",
    "1.18.2",
    "1.18.1",
    "1.17.1",
    "1.16.5",
    "1.16.4",
    "1.16.3",
    "1.16.2",
    "1.16.1",
    "1.15.2",
    "1.15.1",
    "1.14.4",
  ],
  Forge: [
    "1.21.4",
    "1.21.3",
    "1.21.1",
    "1.21",
    "1.20.6",
    "1.20.4",
    "1.20.3",
    "1.20.2",
    "1.20.1",
    "1.19.4",
    "1.19.3",
    "1.19.2",
    "1.18.2",
    "1.17.1",
    "1.16.5",
    "1.16.4",
    "1.16.3",
    "1.12.2",
    "1.10.2",
    "1.8.9",
    "1.7.10",
  ],
  NeoForge: [
    "1.21.5",
    "1.21.4",
    "1.21.3",
    "1.21.2",
    "1.21.1",
    "1.21",
    "1.20.6",
    "1.20.5",
    "1.20.4",
    "1.20.3",
    "1.20.2",
  ],
};

/** Paper / Spigot plugin target Minecraft versions (API level). */
export const MC_VERSIONS_PAPER: string[] = [
  "1.21.5",
  "1.21.4",
  "1.21.3",
  "1.21.2",
  "1.21.1",
  "1.21",
  "1.20.6",
  "1.20.5",
  "1.20.4",
  "1.20.3",
  "1.20.2",
  "1.20.1",
  "1.19.4",
  "1.19.3",
  "1.19.2",
  "1.18.2",
  "1.18.1",
  "1.17.1",
  "1.16.5",
  "1.16.4",
  "1.16.3",
  "1.16.2",
  "1.16.1",
  "1.15.2",
  "1.14.4",
  "1.13.2",
  "1.12.2",
  "1.11.2",
  "1.10.2",
  "1.9.4",
  "1.8.8",
];

export function mcVersionsFor(projectKind: "mod" | "plugin", loader: string): string[] {
  if (projectKind === "plugin") return [...MC_VERSIONS_PAPER];
  const l = loader as ModLoader;
  if (l in MC_VERSIONS_BY_LOADER) return [...MC_VERSIONS_BY_LOADER[l]];
  return [...MC_VERSIONS_BY_LOADER.Fabric];
}

export function pickMcVersionForLoader(
  projectKind: "mod" | "plugin",
  loader: string,
  current: string
): string {
  const list = mcVersionsFor(projectKind, loader);
  if (list.includes(current)) return current;
  return list[0] ?? "1.20.1";
}
