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

export interface FetchOptions {
  /** Progress callback: receives (loaded, total) bytes. total may be 0 if unknown. */
  onProgress?: (loaded: number, total: number) => void;
  /** Number of retries on failure (default: 1) */
  retries?: number;
  /** Delay between retries in ms (default: 2000, doubles each retry) */
  retryDelay?: number;
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
  async getAssetUrl(assetKey: string, opts?: FetchOptions): Promise<string> {
    const cached = this.cache.get(assetKey);
    if (cached) return cached;

    const entry = ASSET_REGISTRY[assetKey];
    if (!entry) {
      throw new Error(
        `Unknown asset: "${assetKey}". Available: ${Object.keys(ASSET_REGISTRY).join(", ")}`,
      );
    }

    const retries = opts?.retries ?? 1;
    const baseDelay = opts?.retryDelay ?? 2000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const blobUrl = await this.fetchWithProgress(entry.remoteUrl, opts?.onProgress);
        this.cache.set(assetKey, blobUrl);
        return blobUrl;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < retries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError ?? new Error(`Failed to fetch asset "${assetKey}"`);
  }

  private async fetchWithProgress(
    url: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    if (!onProgress || !response.body) {
      // No progress tracking needed, simple path
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }

    // Stream with progress
    const contentLength = Number(response.headers.get("Content-Length") || 0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, contentLength);
    }

    const blob = new Blob(chunks as BlobPart[], { type: "model/gltf-binary" });
    return URL.createObjectURL(blob);
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
