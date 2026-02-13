import { preloadImage, toSingleSource, toVariantSource } from "./preload";
import type {
  AtlasPlacement,
  AtlasVariant,
  DomFacade,
  MetadataItem,
  PoseIndex,
  ResolvedImageSource,
  RuntimeState,
} from "./types";

const toAtlasTileTransformCss = (atlas: AtlasPlacement): string =>
  `translate(${-atlas.column * 100}%, ${-atlas.row * 100}%) scale(${atlas.gridSize})`;

export const toTransformCss = (item: MetadataItem): string =>
  item.atlas ? toAtlasTileTransformCss(item.atlas) : "none";

/** Choose the sharpest already-loaded atlas variant for smooth progressive upgrades. */
export const resolveImageSource = (
  item: MetadataItem,
  loadedSources: Set<string>,
): ResolvedImageSource => {
  if (!item.atlas) {
    return { source: toSingleSource(item), variant: "single" };
  }

  const high = toVariantSource(item, "high");
  if (loadedSources.has(high)) {
    return { source: high, variant: "high" };
  }
  const mid = toVariantSource(item, "mid");
  if (loadedSources.has(mid)) {
    return { source: mid, variant: "mid" };
  }
  return { source: toVariantSource(item, "low"), variant: "low" };
};

/**
 * Update the visible frame for a selected metadata item.
 * Uses a synchronous hot path when the source is already cached.
 */
export const createFaceUpdater = (
  dom: DomFacade,
  state: RuntimeState,
  poseIndex: PoseIndex,
): { updateFace: (yaw: number, pitch: number) => void } => {
  const scheduleMicrotask = (task: () => void): void => {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(task);
      return;
    }
    void Promise.resolve().then(task);
  };

  // Facade pattern: keep all visual writes routed through dom helpers.
  const applyItemFrame = (
    item: MetadataItem,
    variant: AtlasVariant | "single",
  ): void => {
    const transformCss = toTransformCss(item);
    dom.setImageTransform(transformCss);
    dom.setImageRendering(
      variant === "high" || variant === "single" ? "auto" : "pixelated",
    );
    state.lastTransform = transformCss;
    state.hasTransform = true;
    dom.renderMetadata(item);
  };

  const scheduleVariantUpgrade = (item: MetadataItem): void => {
    scheduleMicrotask(() => {
      if (!state.currentItem || state.currentItem.file !== item.file) {
        return;
      }

      const upgraded = resolveImageSource(item, state.loadedSources);
      if (upgraded.variant === "low" || upgraded.variant === "single") {
        return;
      }

      if (dom.image && dom.image.src !== upgraded.source) {
        dom.setImageSource(upgraded.source);
      }
      applyItemFrame(item, upgraded.variant);
    });
  };

  const scheduleSourceLoad = (source: string, token: number): void => {
    if (state.pendingSourceLoads.has(source)) {
      return;
    }

    state.pendingSourceLoads.set(source, token);
    void preloadImage(source)
      .then((didLoad) => {
        state.pendingSourceLoads.delete(source);
        if (!didLoad) {
          return;
        }

        state.loadedSources.add(source);
        if (token !== state.token || !state.currentItem) {
          return;
        }

        const resolved = resolveImageSource(
          state.currentItem,
          state.loadedSources,
        );
        if (resolved.source !== source) {
          return;
        }

        if (dom.image && dom.image.src !== source) {
          dom.setImageSource(source);
        }
        applyItemFrame(state.currentItem, resolved.variant);
        if (resolved.variant === "low") {
          scheduleVariantUpgrade(state.currentItem);
        }
      })
      .catch(() => {
        state.pendingSourceLoads.delete(source);
      });
  };

  const updateFace = (yaw: number, pitch: number): void => {
    const item = poseIndex.pickClosest(yaw, pitch, state);
    const nextResolved = resolveImageSource(item, state.loadedSources);
    const nextSource = nextResolved.source;
    const sameItem = state.currentItem?.file === item.file;
    const sameSource = Boolean(dom.image && dom.image.src === nextSource);
    if (sameItem && sameSource && state.hasTransform) {
      return;
    }

    state.currentItem = item;

    if (state.loadedSources.has(nextSource)) {
      if (dom.image && dom.image.src !== nextSource) {
        dom.setImageSource(nextSource);
      }
      applyItemFrame(item, nextResolved.variant);
      if (nextResolved.variant === "low") {
        scheduleVariantUpgrade(item);
      }
      return;
    }

    if (state.hasTransform) {
      dom.setImageTransform(state.lastTransform);
    }

    const token = state.token + 1;
    state.token = token;
    scheduleSourceLoad(nextSource, token);
  };

  return { updateFace };
};

/** Queue only the latest pose update per animation frame. */
export const createPoseCommandQueue = (
  state: RuntimeState,
  updateFace: (yaw: number, pitch: number) => void,
): { enqueue: (yaw: number, pitch: number) => void } => {
  const flush = (): void => {
    state.rafId = 0;
    if (!state.pendingCommand) {
      return;
    }

    const command = state.pendingCommand;
    state.pendingCommand = null;
    updateFace(command.yaw, command.pitch);
  };

  const enqueue = (yaw: number, pitch: number): void => {
    state.pendingCommand = { yaw, pitch };
    if (state.rafId) {
      return;
    }
    state.rafId = requestAnimationFrame(flush);
  };

  return { enqueue };
};
