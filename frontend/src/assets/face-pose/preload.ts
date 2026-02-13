import { PRELOAD_CONFIG } from "./config";
import type {
  AtlasPlacement,
  AtlasVariant,
  MetadataItem,
  PreloadPlan,
  PreloadSummary,
} from "./types";

export const toSingleSource = (item: MetadataItem): string =>
  new URL(`input-images/${item.file}`, document.baseURI).toString();

export const toAtlasVariantSource = (
  atlas: AtlasPlacement,
  variant: AtlasVariant,
): string => new URL(`atlases/${atlas.files[variant]}`, document.baseURI).toString();

export const toVariantSource = (item: MetadataItem, variant: AtlasVariant): string => {
  if (!item.atlas) {
    return toSingleSource(item);
  }
  return toAtlasVariantSource(item.atlas, variant);
};

export const preloadImage = (source: string): Promise<boolean> =>
  new Promise((resolve) => {
    const image = new Image();

    const cleanup = (): void => {
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      cleanup();
      if (typeof image.decode === "function") {
        image.decode().catch(() => undefined).finally(() => resolve(true));
        return;
      }
      resolve(true);
    };

    image.onerror = () => {
      cleanup();
      resolve(false);
    };

    image.src = source;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      cleanup();
      resolve(true);
    }
  });

/**
 * Preload image sources with a bounded async worker pool.
 * Keeps UI responsive while ensuring images are warm in cache before scrub starts.
 */
export const preloadImages = async (
  sources: string[],
  maxConcurrent: number,
  onProgress: (summary: PreloadSummary) => void,
  onSourceLoaded: (source: string) => void = () => undefined,
): Promise<PreloadSummary> => {
  const uniqueSources = Array.from(new Set(sources));
  const total = uniqueSources.length;
  let loaded = 0;
  let failed = 0;
  let cursor = 0;

  onProgress({ total, loaded, failed });

  if (total === 0) {
    return { total, loaded, failed };
  }

  const workerCount = Math.max(1, Math.min(maxConcurrent, total));
  const worker = async (): Promise<void> => {
    for (;;) {
      const nextIndex = cursor;
      cursor += 1;
      if (nextIndex >= total) {
        return;
      }

      const didLoad = await preloadImage(uniqueSources[nextIndex]);
      if (didLoad) {
        loaded += 1;
        onSourceLoaded(uniqueSources[nextIndex]);
      } else {
        failed += 1;
      }
      onProgress({ total, loaded, failed });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { total, loaded, failed };
};

/**
 * Build a staged preload plan:
 * 1) seed tier (3°) blocks first interaction
 * 2) load low-res backfill, then mid-res, then high-res atlas upgrades
 */
export const createPreloadPlan = (metadata: MetadataItem[]): PreloadPlan => {
  const hasTierData = metadata.some((item) => item.preloadTier !== undefined);
  if (hasTierData) {
    const toTierVariantSources = (tier: number, variant: AtlasVariant): string[] => {
      const sources = new Set<string>();
      for (const item of metadata) {
        const itemTier = item.preloadTier ?? 0;
        const isMatch = tier === 3 ? itemTier >= tier : itemTier === tier;
        if (!isMatch) {
          continue;
        }
        sources.add(toVariantSource(item, variant));
      }
      return Array.from(sources).sort();
    };

    const blockingSources = Array.from(
      new Set(
        PRELOAD_CONFIG.initialBlockingLowTiers.flatMap((tier) =>
          toTierVariantSources(tier, "low"),
        ),
      ),
    ).sort();
    const emittedSources = new Set(blockingSources);
    const backgroundStages: string[][] = [];
    const pushStage = (tier: number, variant: AtlasVariant): void => {
      const stage = toTierVariantSources(tier, variant).filter(
        (source) => !emittedSources.has(source),
      );
      if (stage.length === 0) {
        return;
      }
      stage.forEach((source) => emittedSources.add(source));
      backgroundStages.push(stage);
    };

    pushStage(2, "low");
    pushStage(1, "low");
    pushStage(0, "low");
    pushStage(3, "mid");
    pushStage(2, "mid");
    pushStage(1, "mid");
    pushStage(0, "mid");
    pushStage(3, "high");
    pushStage(2, "high");
    pushStage(1, "high");
    pushStage(0, "high");

    return { blockingSources, backgroundStages };
  }

  const usedSources = new Set<string>();
  const stageSources: string[][] = [];

  for (const step of PRELOAD_CONFIG.stagedBucketSteps) {
    const representativeByBucket = new Map<string, MetadataItem>();
    for (const item of metadata) {
      const key = `${Math.round(item.pose.yaw / step)}:${Math.round(item.pose.pitch / step)}:${Math.round(item.pose.roll / step)}`;
      const previous = representativeByBucket.get(key);
      if (!previous || item.interocularDist > previous.interocularDist) {
        representativeByBucket.set(key, item);
      }
    }

    const sources = Array.from(
      new Set(
        Array.from(representativeByBucket.values()).map((item) =>
          toVariantSource(item, "low"),
        ),
      ),
    )
      .filter((source) => !usedSources.has(source))
      .sort();

    if (sources.length === 0) {
      continue;
    }

    sources.forEach((source) => usedSources.add(source));
    stageSources.push(sources);
  }

  if (stageSources.length === 0) {
    return { blockingSources: [], backgroundStages: [] };
  }

  const [blockingSources, ...backgroundStages] = stageSources;
  const midStage = Array.from(
    new Set(metadata.map((item) => toVariantSource(item, "mid"))),
  ).filter((source) => !usedSources.has(source));
  midStage.forEach((source) => usedSources.add(source));
  const highStage = Array.from(
    new Set(metadata.map((item) => toVariantSource(item, "high"))),
  ).filter((source) => !usedSources.has(source));
  const upgradeStages = [midStage, highStage].filter((stage) => stage.length > 0);

  return { blockingSources, backgroundStages: [...backgroundStages, ...upgradeStages] };
};
