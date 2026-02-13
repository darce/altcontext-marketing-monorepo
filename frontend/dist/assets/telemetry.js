(() => {
  // src/assets/telemetry.ts
  var ANON_ID_KEY = "altctx_anon_id";
  var backendUrl = true ? "" : "";
  var getAnonId = () => {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      try {
        localStorage.setItem(ANON_ID_KEY, id);
      } catch {
      }
    }
    return id;
  };
  var sendBeacon = (eventType, props) => {
    if (!backendUrl) {
      return;
    }
    const payload = JSON.stringify({
      anonId: getAnonId(),
      eventType,
      path: location.pathname,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...props && { props }
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
        keepalive: true
      }).catch(() => {
      });
    }
  };
  var trackPageView = () => {
    sendBeacon("page_view");
  };
  var trackEngagement = () => {
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
      { once: false }
    );
    window.addEventListener("unload", () => {
      if (!document.hidden) {
        const engagedTimeMs = Date.now() - engagementStartMs;
        sendBeacon("engagement", { engagedTimeMs });
      }
    });
  };
  var trackScrollDepth = () => {
    let maxScrollDepthPercent = 0;
    const checkScrollDepth = () => {
      const scrollPercentage = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight) * 100;
      maxScrollDepthPercent = Math.max(maxScrollDepthPercent, scrollPercentage);
    };
    document.addEventListener("scroll", checkScrollDepth, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && maxScrollDepthPercent > 0) {
        sendBeacon("scroll_depth", { maxDepthPercent: maxScrollDepthPercent });
      }
    });
    window.addEventListener("unload", () => {
      if (maxScrollDepthPercent > 0) {
        sendBeacon("scroll_depth", { maxDepthPercent: maxScrollDepthPercent });
      }
    });
  };
  var trackFacePoseInteraction = () => {
    const faceContainer = document.getElementById("face-container");
    if (!faceContainer) {
      return;
    }
    let interactionStartMs = null;
    const startInteraction = () => {
      if (!interactionStartMs) {
        interactionStartMs = Date.now();
        sendBeacon("cta_click", { ctaName: "face_pose_viewer" });
      }
    };
    faceContainer.addEventListener("pointerdown", startInteraction);
    faceContainer.addEventListener("touchstart", startInteraction);
    window.addEventListener("unload", () => {
      if (interactionStartMs) {
        const scrubDurationMs = Date.now() - interactionStartMs;
        sendBeacon("face_pose_scrub", { scrubDurationMs });
      }
    });
  };
  var trackWebVitals = () => {
    const vitals = {};
    if ("PerformanceObserver" in window) {
      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          const renderTime = lastEntry.renderTime;
          const loadTime = lastEntry.loadTime;
          vitals.lcpMs = Math.round(
            renderTime || loadTime || lastEntry.startTime
          );
        });
        lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
      } catch {
      }
      try {
        const clsObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          let clsValue = 0;
          for (const entry of entries) {
            const hadRecentInput = entry.hadRecentInput;
            const value = entry.value;
            if (!hadRecentInput && value) {
              clsValue += value;
            }
          }
          vitals.clsScore = Math.round(clsValue * 1e3) / 1e3;
        });
        clsObserver.observe({ entryTypes: ["layout-shift"] });
      } catch {
      }
      try {
        const inpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          const processingDuration = lastEntry.processingDuration;
          vitals.inpMs = Math.round(processingDuration || 0);
        });
        inpObserver.observe({ entryTypes: ["event"] });
      } catch {
      }
    }
    const perfData = performance.timing;
    if (perfData.responseStart && perfData.navigationStart) {
      vitals.ttfbMs = perfData.responseStart - perfData.navigationStart;
    }
    const vitalsTimeout = setTimeout(() => {
      if (Object.keys(vitals).length > 0) {
        sendBeacon("cwv", { webVitals: vitals });
      }
    }, 2500);
    window.addEventListener("unload", () => {
      clearTimeout(vitalsTimeout);
      if (Object.keys(vitals).length > 0) {
        sendBeacon("cwv", { webVitals: vitals });
      }
    });
  };
  var enhanceEmailForm = () => {
    const form = document.getElementById("email-form");
    if (!form || !backendUrl) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const emailInput = form.querySelector(
        "[name=email]"
      );
      const honeypotInput = form.querySelector(
        "[name=honeypot]"
      );
      if (!emailInput) return;
      const email = emailInput.value.trim();
      const honeypot = honeypotInput?.value.trim() ?? "";
      sendBeacon("form_submit", { formName: "email_capture" });
      fetch(`${backendUrl}/v1/leads/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          anonId: getAnonId(),
          path: location.pathname,
          honeypot
        })
      }).then((res) => {
        if (res.ok) {
          const successDiv = document.createElement("div");
          successDiv.className = "email-capture";
          successDiv.innerHTML = `<p class="email-capture-success">Thanks! We'll be in touch.</p>`;
          form.replaceWith(successDiv);
        } else {
          showFormError(form, "Something went wrong. Please try again.");
        }
      }).catch(() => {
        showFormError(form, "Network error. Please try again.");
      });
    });
  };
  var showFormError = (form, message) => {
    let errorEl = form.querySelector(".email-capture-error");
    if (!errorEl) {
      errorEl = document.createElement("p");
      errorEl.className = "email-capture-error";
      form.appendChild(errorEl);
    }
    const errorElTyped = errorEl;
    errorElTyped.textContent = message;
    setTimeout(() => {
      errorElTyped.remove();
    }, 5e3);
  };
  var init = () => {
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
})();
