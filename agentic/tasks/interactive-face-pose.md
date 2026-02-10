# Interactive Face Pose Script

## Problem Statement

Enable interactive mapping of mouse movements to face poses (Pitch/Yaw) using images with embedded XMP metadata. The goal is to show a head composed of different images that moves smoothly with user input, maintaining consistent scale and location.

## Workflow Principles

- **Minimize FCP**: Maintain initial payload < 14KB.
- **Build-time Extraction (tsx)**: `extract-metadata.ts` is run at **build time** (using Node.js/tsx) to produce a static `metadata.json`. It is NOT a runtime script.
- **Vanilla JS & SCSS**: The frontend only fetches the processed JSON. No binary parsing occurs in the browser.
- **TypeScript for Tooling**: We use TS for the extraction script because the repo already uses `tsx` for build-time tasks (like `critcss.ts`). This keeps the build pipeline consistent.
- **Mobile-first**: Ensure the interactive experience works or gracefully degrades on mobile.

## Terminology

- **acx**: Custom XMP namespace (`http://alt-context.dev/ns/1.0/`) containing pose data.
- **Iptc4xmpExt**: Standard XMP namespace for Image Region metadata.
- **Pitch/Yaw/Roll**: Orientation angles extracted from `acx` metadata.
- **RegionBoundary**: XMP data defining the bounding box of the face in relative coordinates.

## Current State Analysis

- `input-images/`: Directory contains ~500 images with embedded XMP data.
- `src/` & `styles/`: Currently empty; need initialization.
- `package.json`: Contains basic build pipeline for SCSS and TS tooling.
- Metadata extraction is missing from the current build process.

## Proposed Solution

Implement a build-time script `build/extract-metadata.ts` using `tsx`. This script will parse the XMP block of each image in `input-images/`, extract face region and pose data, and consolidate it into `public/metadata.json`.

The frontend will consist of a vanilla JS module that fetches `metadata.json`, initializes an interactive container, and maps mouse coordinates to the closest Yaw/Pitch pair. CSS will be used to align and scale the face within the container based on the extracted region data.

## Patterns to Follow

### Build-time XMP Parsing (Binary Scan)
Since XMP is embedded as an XML payload within a specific APP1 segment (header: `http://ns.adobe.com/xap/1.0/\0`), we will:
1. `fs.readFileSync` the image into a Buffer.
2. Locate the UTF-8 header for the XMP segment.
3. Extract the XML string starting from `<x:xmpmeta` and ending with `</x:xmpmeta>`.
4. Parse the extracted XML using regex or `libxml2`/`tidy-html5` if needed.

```typescript
const buffer = fs.readFileSync(imagePath);
const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
const offset = buffer.indexOf(xmpHeader);
if (offset !== -1) {
    const xmpStart = buffer.indexOf('<x:xmpmeta', offset);
    const xmpEnd = buffer.indexOf('</x:xmpmeta>', xmpStart) + 12;
    const xmpString = buffer.toString('utf8', xmpStart, xmpEnd);
}
```

### XMP Writing & Mock Generation
To support testing, the script can also inject XMP into images:
1. Load a "blank" or template JPEG.
2. Construct the XMP XML string with target pose/region data.
3. Prepend the APP1 segment header and length.
4. Insert the segment after the SOI (Start of Image) marker or before an existing segment.

### Async JSON Fetch
```javascript
const metadata = await fetch('metadata.json').then(r => r.json());
```

## Functions to Change

| File | Line | Change |
| --- | --- | --- |
| `package.json` | 11 | Add `build:metadata` to `build` script. |

## Related Files

| File | Note |
| --- | --- |
| `input-images/` | Source of truth for XMP metadata. |
| `public/` | Target directory for the generated `metadata.json`. |

---

# Consolidated Checklist

## Phase 0: Scaffolding
- [ ] Initialize `src/` and `styles/` directories.
- [ ] Create `styles/site.scss` entrypoint.
- [ ] Create `src/index.html` skeleton.

## Phase 1: Metadata Extraction & Mocks
- [ ] Create `build/extract-metadata.ts` for extraction and basic injection.
- [ ] Create `offline-scripts/generate-mocks.ts` to create a controlled test set.
- [ ] Extract `Iptc4xmpExt:RegionBoundary` and `acx` pose data.
- [ ] Write consolidated `public/metadata.json`.
- [ ] Add `build:metadata` to `package.json`.

## Phase 2: UI & Interaction
- [ ] Create `styles/face-pose.scss` with face-alignment utility classes.
- [ ] Create `src/face-pose.js` for interactivity and pose mapping.
- [ ] Implement image swapping logic (nearest-neighbor pose search).
- [ ] Implement CSS-based centering and scaling based on metadata.

## Phase 3: Verification
- [ ] Run `npm run build` and verify `dist/` output.
- [ ] Verify FCP is within 14KB budget.
- [ ] Verify mouse interactivity on `dev.test`.

## Success Criteria

- Mouse movement over the image container triggers smooth image swaps.
- Faces are perfectly aligned and scaled in the center of the viewport regardless of image source.
- No layout thrash (CLS) during image transitions.
