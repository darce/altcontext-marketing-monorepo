Bug 1: border-radius: 50% broken — square viewport on mobile
Root cause: #face-image has will-change: transform, which promotes it to its own GPU compositing layer. On mobile Safari, composited children can escape the parent's overflow: hidden + border-radius clip. The filter: grayscale(100%) contrast(1.8) from .duotone img also creates a compositing layer.

Fix:

Remove will-change: transform from #face-image — it's redundant since filter already forces GPU promotion
Add clip-path: circle(50%) on .face-pose-viewer as a hard clip that survives compositing layer boundaries on mobile
Add border-radius: 50% to the inline critical CSS (currently missing — the square shows during async CSS load)
Bug 2: Duotone colours not applying
Root cause: The duotone uses pseudo-element ::before (multiply) + ::after (screen) with mix-blend-mode. The image has filter: grayscale(100%) contrast(1.8) which creates a compositing boundary. On mobile Safari, mix-blend-mode on pseudo-elements cannot blend across this compositing boundary — it blends with the container background instead of the filtered image.

Two fix options:

Option A — SVG filter duotone (recommended). Replace the pseudo-element blend approach with an inline SVG <filter> that does grayscale + contrast + duotone color remap in a single compositing pass on the image. No cross-layer blending needed. Works everywhere.

Image gets filter: url(#duotone) instead of filter: grayscale() contrast(). Pseudo-elements removed.

Option B — Move filter to container. Apply filter: grayscale(100%) contrast(1.8) on .face-pose-viewer instead of the image, so everything (image + pseudo-element blend results) is processed together. Simpler, but changes the visual result slightly (contrast applies after blend, not before).

Scrubbing on mobile — proposals
Option 1 — Gyroscope (recommended for this demo). Map DeviceOrientationEvent beta/gamma to pitch/yaw. Natural "look around" metaphor for a face-pose demo. Falls back to touch-drag if permission denied or unavailable.

Pros: Magical feel, no UI chrome, perfect for showing off face recognition
Cons: Requires iOS permission prompt (DeviceOrientationEvent.requestPermission()), not available on all devices
Implementation: ~40 lines — listen for deviceorientation, map gamma→yaw and beta→pitch, feed same commandQueue.enqueue()
Option 2 — Circular joystick overlay. A small draggable thumb inside a circular track overlaid on the bottom of the face viewer. Touch-drag the thumb to control yaw/pitch.

Pros: Familiar touch UI, no permissions needed, works everywhere
Cons: Adds visual clutter, partially obscures the face
Option 3 — Dual range sliders. Horizontal slider below the face (yaw) + vertical slider beside it (pitch). Purely functional.

Pros: Maximally accessible, clear affordance
Cons: Breaks the clean circular viewport aesthetic, takes extra layout space
Recommendation: Gyroscope as primary on mobile with touch-drag on the face viewer as fallback. The gyroscope is the most compelling for a face-recognition product demo — tilting your phone to rotate the face is an immediate "wow" moment. Add a small "tap to enable motion" overlay on first visit to trigger the iOS permission prompt gracefully.