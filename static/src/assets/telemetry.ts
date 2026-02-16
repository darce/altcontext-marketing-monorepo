// frontend/src/assets/telemetry.ts
// Non-blocking beacon system for page events and lead capture

const ANON_ID_KEY = "altctx_anon_id";

// BACKEND_URL is injected at build time via esbuild --define
declare const BACKEND_URL: string;

const backendUrl = typeof BACKEND_URL === "string" ? BACKEND_URL : "";

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

// Send non-blocking beacon via navigator.sendBeacon or fetch with keepalive
const sendBeacon = (
  eventType: string,
  props?: Record<string, unknown>,
): void => {
  if (!backendUrl) {
    return;
  }

  const payload = JSON.stringify({
    anonId: getAnonId(),
    eventType,
    path: location.pathname,
    timestamp: new Date().toISOString(),
    ...(props && { props }),
  });

  const sendBeaconFn = navigator.sendBeacon;
  if (typeof sendBeaconFn === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    sendBeaconFn.call(navigator, `${backendUrl}/v1/events`, blob);
  } else {
    fetch(`${backendUrl}/v1/events`, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {
      // Silently fail — don't block page
    });
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
        sendBeacon("engagement", { engagedTimeMs });
      } else {
        engagementStartMs = Date.now();
      }
    },
    { once: false },
  );

  // Also send on unload if still visible
  window.addEventListener("unload", () => {
    if (!document.hidden) {
      const engagedTimeMs = Date.now() - engagementStartMs;
      sendBeacon("engagement", { engagedTimeMs });
    }
  });
};

// Track scroll depth via sentinel elements
const trackScrollDepth = (): void => {
  let maxScrollDepthPercent = 0;

  const checkScrollDepth = (): void => {
    const scrollPercentage =
      (window.scrollY /
        (document.documentElement.scrollHeight - window.innerHeight)) *
      100;
    maxScrollDepthPercent = Math.max(maxScrollDepthPercent, scrollPercentage);
  };

  document.addEventListener("scroll", checkScrollDepth, { passive: true });

  // Send scroll depth on visibility change
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && maxScrollDepthPercent > 0) {
      sendBeacon("scroll_depth", { maxDepthPercent: maxScrollDepthPercent });
    }
  });

  // And on unload
  window.addEventListener("unload", () => {
    if (maxScrollDepthPercent > 0) {
      sendBeacon("scroll_depth", { maxDepthPercent: maxScrollDepthPercent });
    }
  });
};

// Track CTA (face-pose viewer) interaction
const trackFacePoseInteraction = (): void => {
  const faceContainer = document.getElementById("face-container");
  if (!faceContainer) {
    return;
  }

  let interactionStartMs: number | null = null;

  const startInteraction = (): void => {
    if (!interactionStartMs) {
      interactionStartMs = Date.now();
      sendBeacon("cta_click", { ctaName: "face_pose_viewer" });
    }
  };

  // Listen for pointer and touch events
  faceContainer.addEventListener("pointerdown", startInteraction);
  faceContainer.addEventListener("touchstart", startInteraction);

  // Send on unload if interaction started
  window.addEventListener("unload", () => {
    if (interactionStartMs) {
      const scrubDurationMs = Date.now() - interactionStartMs;
      sendBeacon("face_pose_scrub", { scrubDurationMs });
    }
  });
};

// Capture Web Vitals using PerformanceObserver
const trackWebVitals = (): void => {
  const vitals: Record<string, number> = {};

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
      lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
    } catch {
      // Not all browsers support LCP
    }

    // Cumulative Layout Shift
    try {
      const clsObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        let clsValue = 0;
        for (const entry of entries) {
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
      clsObserver.observe({ entryTypes: ["layout-shift"] });
    } catch {
      // No CLS support
    }

    // Interaction to Next Paint (INP)
    try {
      const inpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        const processingDuration = (
          lastEntry as unknown as { processingDuration?: number }
        ).processingDuration;
        vitals.inpMs = Math.round(processingDuration || 0);
      });
      inpObserver.observe({ entryTypes: ["event"] });
    } catch {
      // No INP support
    }
  }

  // First Contentful Paint and TTFB via PerformanceTiming
  const perfData = performance.timing;
  if (perfData.responseStart && perfData.navigationStart) {
    vitals.ttfbMs = perfData.responseStart - perfData.navigationStart;
  }

  // Send vitals beacon after LCP settles (approx 2.5s)
  const vitalsTimeout = setTimeout(() => {
    if (Object.keys(vitals).length > 0) {
      sendBeacon("cwv", { webVitals: vitals });
    }
  }, 2500);

  // Also send on unload
  window.addEventListener("unload", () => {
    clearTimeout(vitalsTimeout);
    if (Object.keys(vitals).length > 0) {
      sendBeacon("cwv", { webVitals: vitals });
    }
  });
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
    const honeypot = honeypotInput?.value.trim() ?? "";

    // Fire beacon that form was submitted
    sendBeacon("form_submit", { formName: "email_capture" });

    // Send to backend
    fetch(`${backendUrl}/v1/leads/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        anonId: getAnonId(),
        path: location.pathname,
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
          showFormError(form, "Something went wrong. Please try again.");
        }
      })
      .catch(() => {
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
