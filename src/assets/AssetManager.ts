/**
 * AssetManager — fetch, cache, and attribute avatar assets.
 *
 * Provides a local URL for the web viewer to consume.
 * Handles attribution requirements per asset license.
 */

export interface AssetEntry {
  /** Display name of the persona/asset */
  name: string;
  /** Remote URL to fetch the asset from */
  remoteUrl: string;
  /** License identifier */
  license: string;
  /** Attribution text (required for redistribution) */
  attribution: string;
  /** License URL */
  licenseUrl: string;
}

/** Built-in asset registry */
export const ASSET_REGISTRY: Record<string, AssetEntry> = {
  ellie: {
    name: "Ellie",
    remoteUrl:
      "https://raw.githubusercontent.com/tjamescouch/personas/main/ellie/ellie_animation.glb",
    license: "CC BY 4.0",
    attribution: "Ellie — CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
};

/**
 * AssetManager fetches GLB assets and provides blob URLs for the viewer.
 * Caches in memory (Map<string, string>) to avoid redundant fetches.
 */
export class AssetManager {
  private cache = new Map<string, string>();

  /**
   * Get a usable URL for the named asset.
   * If not cached, fetches from the remote URL and creates a blob URL.
   */
  async getAssetUrl(assetKey: string): Promise<string> {
    const cached = this.cache.get(assetKey);
    if (cached) return cached;

    const entry = ASSET_REGISTRY[assetKey];
    if (!entry) {
      throw new Error(`Unknown asset: "${assetKey}". Available: ${Object.keys(ASSET_REGISTRY).join(", ")}`);
    }

    const response = await fetch(entry.remoteUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset "${assetKey}": ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    this.cache.set(assetKey, blobUrl);
    return blobUrl;
  }

  /** Get attribution info for an asset */
  getAttribution(assetKey: string): AssetEntry | undefined {
    return ASSET_REGISTRY[assetKey];
  }

  /** Release all cached blob URLs */
  dispose(): void {
    for (const url of this.cache.values()) {
      URL.revokeObjectURL(url);
    }
    this.cache.clear();
  }
}
