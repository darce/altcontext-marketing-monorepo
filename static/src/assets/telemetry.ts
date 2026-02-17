// frontend/src/assets/telemetry.ts
// Non-blocking beacon system for page events and lead capture

const ANON_ID_KEY = "altctx_anon_id";

// BACKEND_URL and INGEST_API_KEY are injected at build time via esbuild --define
declare const BACKEND_URL: string;
declare const INGEST_API_KEY: string;

const backendUrl = typeof BACKEND_URL === "string" ? BACKEND_URL : "";
const ingestApiKey = typeof INGEST_API_KEY === "string" ? INGEST_API_KEY : "";

// Get or create stable anonymous visitor ID
const getAnonId = (): string => {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(ANON_ID_KEY, id);
    } catch {
      // localStorage may be unavailable in some contexts
    }
  }
  return id;
};

// Get UTM parameters from query string
const getUtmParams = (): Record<string, string> | undefined => {
  try {
    const params = new URLSearchParams(location.search);
    const utm: Record<string, string> = {};
    const keys = ["source", "medium", "campaign", "term", "content"];
    for (const key of keys) {
      const val = params.get(`utm_${key}`);
      if (val) utm[key] = val;
    }
    return Object.keys(utm).length > 0 ? utm : undefined;
  } catch {
    return undefined;
  }
};

// Send non-blocking beacon via navigator.sendBeacon or fetch with keepalive
const sendBeacon = (
  eventType: string,
  props?: Record<string, unknown>,
  traffic?: Record<string, unknown>,
): void => {
  if (!backendUrl) {
    return;
  }

  const payload = JSON.stringify({
    anonId: getAnonId(),
    eventType,
    path: location.pathname,
    referrer: document.referrer || undefined,
    timestamp: new Date().toISOString(),
    utm: getUtmParams(),
    ...(props && { props }),
    ...(traffic && { traffic }),
  });

  // Prefer fetch with keepalive as it supports custom headers (for API key)
  if (typeof fetch === "function") {
    fetch(`${backendUrl}/v1/events`, {
      method: "POST",
      body: payload,
      headers: {
        "Content-Type": "application/json",
        ...(ingestApiKey && { "x-api-key": ingestApiKey }),
      },
      keepalive: true,
    }).catch(() => {
      // Silently fail — don't block page
    });
    return;
  }

  // Fallback to sendBeacon (no custom headers support)
  const sendBeaconFn = navigator.sendBeacon;
  if (typeof sendBeaconFn === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    sendBeaconFn.call(navigator, `${backendUrl}/v1/events`, blob);
  }
};

// Track page load
const trackPageView = (): void => {
  sendBeacon("page_view");
};

// Track engagement on visibility change
const trackEngagement = (): void => {
  let engagementStartMs = Date.now();

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        const engagedTimeMs = Date.now() - engagementStartMs;
        sendBeacon("engagement", undefined, { engagedTimeMs });
      } else {
        engagementStartMs = Date.now();
      }
    },
    { once: false },
  );

  // Also send on pagehide if still visible (B1: unload -> pagehide)
  window.addEventListener(
    "pagehide",
    () => {
      if (!document.hidden) {
        const engagedTimeMs = Date.now() - engagementStartMs;
        sendBeacon("engagement", undefined, { engagedTimeMs });
      }
    },
    { once: true },
  );
};

// Track scroll depth via sentinel elements
const trackScrollDepth = (): void => {
  let maxScrollDepthPercent = 0;
  let sent = false;

  const checkScrollDepth = (): void => {
    const scrollPercentage =
      (window.scrollY /
        (document.documentElement.scrollHeight - window.innerHeight)) *
      100;
    maxScrollDepthPercent = Math.max(maxScrollDepthPercent, scrollPercentage);
  };

  document.addEventListener("scroll", checkScrollDepth, { passive: true });

  const sendScrollBeacon = (): void => {
    if (!sent && maxScrollDepthPercent > 0) {
      sent = true;
      sendBeacon("scroll_depth", undefined, {
        scrollDepthPercent: Math.round(maxScrollDepthPercent),
      });
    }
  };

  // Send scroll depth on visibility change
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      sendScrollBeacon();
    }
  });

  // And on pagehide (B1: unload -> pagehide)
  window.addEventListener("pagehide", sendScrollBeacon, { once: true });
};

// Track CTA (face-pose viewer) interaction
const trackFacePoseInteraction = (): void => {
  const faceContainer = document.getElementById("face-container");
  if (!faceContainer) {
    return;
  }

  let interactionStartMs: number | null = null;
  let sent = false;

  const startInteraction = (): void => {
    if (!interactionStartMs) {
      interactionStartMs = Date.now();
      sendBeacon("cta_click", { ctaName: "face_pose_viewer" });
    }
  };

  // Listen for pointer and touch events
  faceContainer.addEventListener("pointerdown", startInteraction);
  faceContainer.addEventListener("touchstart", startInteraction);

  // Send on pagehide if interaction started (B1: unload -> pagehide)
  window.addEventListener(
    "pagehide",
    () => {
      if (!sent && interactionStartMs) {
        sent = true;
        const scrubDurationMs = Date.now() - interactionStartMs;
        sendBeacon("face_pose_scrub", { scrubDurationMs });
      }
    },
    { once: true },
  );
};

// Capture Web Vitals using PerformanceObserver
const trackWebVitals = (): void => {
  const vitals: Record<string, number> = {};
  let clsValue = 0;
  let worstInp = 0;
  let sent = false;

  // FCP, LCP, INP, CLS via PerformanceObserver
  if ("PerformanceObserver" in window) {
    // Largest Contentful Paint
    try {
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        const renderTime = (lastEntry as unknown as { renderTime?: number })
          .renderTime;
        const loadTime = (lastEntry as unknown as { loadTime?: number })
          .loadTime;
        vitals.lcpMs = Math.round(
          (renderTime || loadTime || lastEntry.startTime) as number,
        );
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Not all browsers support LCP
    }

    // Cumulative Layout Shift (B3: Accumulate outside callback)
    try {
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const hadRecentInput = (
            entry as unknown as { hadRecentInput?: boolean }
          ).hadRecentInput;
          const value = (entry as unknown as { value?: number }).value;
          if (!hadRecentInput && value) {
            clsValue += value;
          }
        }
        vitals.clsScore = Math.round(clsValue * 1000) / 1000;
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
    } catch {
      // No CLS support
    }

    // Interaction to Next Paint (INP) (A2: Track worst interacting duration)
    try {
      const inpObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.duration > worstInp) {
            worstInp = entry.duration;
            vitals.inpMs = Math.round(worstInp);
          }
        }
      });
      inpObserver.observe({ type: "interaction", buffered: true });
    } catch {
      // No INP support
    }

    // First Contentful Paint
    try {
      const paintObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            vitals.fcpMs = Math.round(entry.startTime);
          }
        }
      });
      paintObserver.observe({ type: "paint", buffered: true });
    } catch {
      // No paint observer support
    }
  }

  // TTFB via PerformanceNavigationTiming (A1: Modern API)
  const navEntry = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navEntry) {
    vitals.ttfbMs = Math.round(navEntry.responseStart);
  } else {
    // Fallback to legacy PerformanceTiming (deprecated)
    const perfData = performance.timing;
    if (perfData.responseStart && perfData.navigationStart) {
      vitals.ttfbMs = perfData.responseStart - perfData.navigationStart;
    }
  }

  const sendVitalsBeacon = (): void => {
    if (!sent && Object.keys(vitals).length > 0) {
      sent = true;
      sendBeacon("cwv", undefined, { webVitals: vitals });
    }
  };

  // Send vitals beacon after LCP settles (approx 2.5s)
  setTimeout(sendVitalsBeacon, 2500);

  // Also send on pagehide (B1: unload -> pagehide)
  window.addEventListener("pagehide", sendVitalsBeacon, { once: true });
};

// JS-enhance email form with inline submit
const enhanceEmailForm = (): void => {
  const form = document.getElementById("email-form") as HTMLFormElement | null;
  if (!form || !backendUrl) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const emailInput = form.querySelector(
      "[name=email]",
    ) as HTMLInputElement | null;
    const honeypotInput = form.querySelector(
      "[name=honeypot]",
    ) as HTMLInputElement | null;

    if (!emailInput) return;

    const email = emailInput.value.trim();
    const honeypot = honeypotInput?.value.trim() || undefined;

    // Disable button to prevent double-submit (A3)
    const submitBtn = form.querySelector(
      "button[type=submit]",
    ) as HTMLButtonElement | null;
    if (submitBtn) submitBtn.disabled = true;

    // Fire beacon that form was submitted
    sendBeacon("form_submit", { formName: "email_capture" });

    // Send to backend
    fetch(`${backendUrl}/v1/leads/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ingestApiKey && { "x-api-key": ingestApiKey }),
      },
      body: JSON.stringify({
        email,
        anonId: getAnonId(),
        path: location.pathname,
        utm: getUtmParams(),
        honeypot,
      }),
    })
      .then((res) => {
        if (res.ok) {
          // Replace form with success message
          const successDiv = document.createElement("div");
          successDiv.className = "email-capture";
          successDiv.innerHTML =
            '<p class="email-capture-success">Thanks! We\'ll be in touch.</p>';
          form.replaceWith(successDiv);
        } else {
          if (submitBtn) submitBtn.disabled = false;
          showFormError(form, "Something went wrong. Please try again.");
        }
      })
      .catch(() => {
        if (submitBtn) submitBtn.disabled = false;
        showFormError(form, "Network error. Please try again.");
      });
  });
};

const showFormError = (form: HTMLFormElement, message: string): void => {
  let errorEl = form.querySelector(".email-capture-error");
  if (!errorEl) {
    errorEl = document.createElement("p");
    errorEl.className = "email-capture-error";
    form.appendChild(errorEl);
  }
  const errorElTyped = errorEl as HTMLElement;
  errorElTyped.textContent = message;

  // Clear error after 5s
  setTimeout(() => {
    errorElTyped.remove();
  }, 5000);
};

// Initialize telemetry on DOM ready
const init = (): void => {
  trackPageView();
  trackEngagement();
  trackScrollDepth();
  trackFacePoseInteraction();
  trackWebVitals();
  enhanceEmailForm();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
