import { SELECTORS } from "./config";
import type { DomFacade, MetadataItem } from "./types";

export const createDomFacade = (): DomFacade => {
  const faceContainer = document.getElementById(SELECTORS.container);
  const scrubSurface = document.querySelector<HTMLElement>(
    SELECTORS.scrubSurface,
  );
  const interactionSurface =
    scrubSurface instanceof HTMLElement
      ? scrubSurface
      : faceContainer instanceof HTMLElement
        ? faceContainer
        : null;
  const image = document.getElementById(SELECTORS.image);
  const loader = document.getElementById(SELECTORS.loader);
  const metadataPanel = document.getElementById(SELECTORS.metadataPanel);
  const metadataTitle = document.getElementById(SELECTORS.metadataTitle);

  const hasRequiredNodes =
    faceContainer instanceof HTMLElement &&
    interactionSurface instanceof HTMLElement &&
    image instanceof HTMLImageElement &&
    loader instanceof HTMLElement;

  const setLoaderText = (text: string): void => {
    if (!(loader instanceof HTMLElement)) {
      return;
    }
    loader.textContent = text;
  };

  const hideLoader = (): void => {
    if (!(loader instanceof HTMLElement)) {
      return;
    }
    loader.style.display = "none";
  };

  const showImage = (): void => {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }
    image.style.display = "block";
  };

  const setImageSource = (src: string): void => {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }
    image.src = src;
  };

  const setImageTransform = (transform: string): void => {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }
    image.style.transform = transform;
  };

  const setImageRendering = (mode: "pixelated" | "auto"): void => {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }
    image.style.imageRendering = mode;
  };

  const getContainerRect = (): DOMRect | null => {
    if (!(interactionSurface instanceof HTMLElement)) {
      return null;
    }
    return interactionSurface.getBoundingClientRect();
  };

  const renderMetadata = (item: MetadataItem): void => {
    if (!(metadataPanel instanceof HTMLElement)) {
      return;
    }

    if (metadataTitle instanceof HTMLElement) {
      metadataTitle.textContent = item.name ?? "Unknown";
    }

    metadataPanel.textContent =
      `interocularDist: ${item.interocularDist}\n` +
      `landmarkConfidence: ${item.landmarkConfidence}\n` +
      `pitch: ${item.pose.pitch}\n` +
      `yaw: ${item.pose.yaw}\n` +
      `roll: ${item.pose.roll}`;
  };

  return {
    hasRequiredNodes,
    container: interactionSurface,
    image: image instanceof HTMLImageElement ? image : null,
    setLoaderText,
    hideLoader,
    showImage,
    setImageSource,
    setImageTransform,
    setImageRendering,
    getContainerRect,
    renderMetadata,
  };
};
