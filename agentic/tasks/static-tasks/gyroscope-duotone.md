# Task: Gyroscope & Duotone Implementation

This task tracks the implementation of mobile-optimized circular face-pose viewing with duotone effects and motion-based control.

---

## Bug 1: Circular Viewport Clipping (Mobile)

**Problem**: `border-radius: 50%` fails when children are promoted to the GPU (via `will-change` or `filter`).
**Relevant Files**:
- [src/index.html](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/src/index.html) (inline styles)
- [styles/_face-pose.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_face-pose.scss)

**Fix**:
1. Remove `will-change: transform` from `#face-image`.
2. Add `clip-path: circle(50%)` to `.face-pose-viewer` as a robust clip.
3. Sync inline critical CSS in `index.html` with these changes.

---

## Bug 2: Duotone Colors (Compositing Boundary)

**Problem**: CSS `mix-blend-mode` fails when blending across compositing layers (common on mobile).
**Relevant Files**:
- [styles/_face-pose.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_face-pose.scss)
- [src/index.html](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/src/index.html) (SVG filter injection)

**Fix (SVG Filter)**:
Replace pseudo-element blending with an inline SVG `<filter>` that performs grayscale, contrast, and color remapping in one pass.

---

## Feature: Gyroscope Control (Mobile)

**Goal**: Map phone tilt to face yaw/pitch.
**Relevant Files**:
- [src/assets/face-pose/index.ts](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/src/assets/face-pose/index.ts)
- [src/assets/face-pose/config.ts](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/src/assets/face-pose/config.ts)

**Requirements**:
1. Handle `DeviceOrientationEvent.requestPermission()` for iOS.
2. Normalize `gamma` (−90° to +90°) and `beta` to full pose ranges.
3. Coordinate with pointer input (prioritize whichever is active).
4. Add noise filtering to prevent jitter.

---

## Acceptance Criteria

- [ ] Viewer is a perfect circle on mobile Safari (no square corners during load).
- [ ] Duotone colors (Green shadows, Pink highlights) are correctly applied.
- [ ] Gyroscope rotates face yaw/pitch smoothly on supported devices.
- [ ] Tapping the "Motion" overlay grants permission and hides it.
- [ ] Pointer input (touch/mouse) remains functional and doesn't jitter with gyro.
- [ ] Build pipeline (`make build`) passes without errors.