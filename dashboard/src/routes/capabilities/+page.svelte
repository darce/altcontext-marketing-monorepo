<script lang="ts">
  import type { PageData } from "./$types";

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const metrics = [
    {
      name: "Unique Visitors",
      description: "De-duplicated visitor count via privacy-safe anonymous ID (SHA-256 of IP + UA + daily salt).",
      derived: false,
    },
    {
      name: "Returning Visitor %",
      description: "Ratio of visitors seen on multiple days — measures audience loyalty without cookies or PII.",
      derived: false,
    },
    {
      name: "Page Views & Sessions",
      description: "Raw page_view events grouped into 30-minute inactivity-bounded sessions. Tracks pages/session and session duration.",
      derived: false,
    },
    {
      name: "Scroll Depth",
      description: "Beacon-reported max scroll percentage per page view. Indicates content engagement beyond the fold.",
      derived: false,
    },
    {
      name: "Core Web Vitals",
      description: "LCP, CLS, and INP captured via browser Performance API beacons. Monitors real-user experience.",
      derived: false,
    },
    {
      name: "Traffic Source Mix",
      description: "Referer-header analysis categorised into direct, search, social, and referral buckets.",
      derived: false,
    },
    {
      name: "Daily Metric Rollups",
      description: "Pre-aggregated daily summaries (unique visitors, page views, avg session duration) for fast dashboard queries.",
      derived: false,
    },
    {
      name: "Ingest Rollups",
      description: "Daily counts of accepted vs. rejected events per property — monitors pipeline health and spam levels.",
      derived: false,
    },
  ];

  const capabilities = [
    {
      name: "Email Capture",
      description:
        "Lead capture via POST /v1/leads/capture. Supports JS and no-JS form submission. Links email identity to anonymous visitor profile. Stores explicit CASL consent with timestamp.",
      status: "active",
    },
    {
      name: "Consent Audit Log",
      description:
        "Every consent grant and withdrawal is recorded in consent_events with action, IP hash, and UA hash — full CASL/PIPEDA compliance trail.",
      status: "active",
    },
    {
      name: "Unsubscribe Processing",
      description:
        "POST /v1/leads/unsubscribe immediately withdraws consent. Processed server-side with no delay.",
      status: "active",
    },
    {
      name: "IP Hashing",
      description:
        "IP addresses are SHA-256 hashed server-side with a rotating daily salt before storage. Raw IPs are never persisted — enables visitor de-duplication while preserving privacy.",
      status: "active",
    },
    {
      name: "User-Agent Hashing",
      description:
        "UA strings are hashed alongside IP for visitor fingerprinting. The hash is deterministic within a day but non-reversible.",
      status: "active",
    },
    {
      name: "Rate Limiting & Spam Controls",
      description:
        "All write endpoints are rate-limited. Rejected events are logged to ingest_rejections for audit and tuning.",
      status: "active",
    },
  ];

  const futureFeatures = [
    {
      name: "Geo Enrichment",
      description:
        "MaxMind GeoLite2 lookup at ingest time → country_code and region stored on each event. Enables geographic traffic breakdowns without retaining raw IP.",
    },
    {
      name: "Cohort Analysis",
      description:
        "Group visitors by first-seen date to track retention curves. Derivable from existing session + visitor data with no schema changes.",
    },
    {
      name: "Multi-Touch Attribution",
      description:
        "Chain of events from first page_view through email capture to conversion. Derivable from the events → leads → form_submissions join path.",
    },
    {
      name: "Content Performance Scoring",
      description:
        "Rank pages by composite engagement (scroll depth × session duration × return rate). All inputs already captured.",
    },
    {
      name: "Anomaly Detection",
      description:
        "Flag unusual traffic spikes or drop-offs using daily rollup time series. Statistical outlier detection on existing aggregated data.",
    },
    {
      name: "Conversion Funnels",
      description:
        "Define step sequences (page_view → scroll_depth > 75% → form_submit) and measure drop-off. Built from the event stream with no new instrumentation.",
    },
    {
      name: "Multi-Tenancy",
      description:
        "Tenant isolation via PostgreSQL RLS. Per-tenant API keys, dashboard auth, and data partitioning. See the multi-tenancy roadmap.",
    },
  ];
</script>

<svelte:head>
  <title>Capabilities — AltContext</title>
</svelte:head>

<section class="page">
  <h1 class="page-title mono">CAPABILITIES</h1>
  <p class="subtitle">What AltContext captures, why it matters, and what becomes possible.</p>

  <div class="section">
    <h2 class="section-title mono">METRICS COLLECTED</h2>
    <div class="card-list">
      {#each metrics as m}
        <div class="card">
          <h3 class="card-name">{m.name}</h3>
          <p class="card-desc">{m.description}</p>
        </div>
      {/each}
    </div>
  </div>

  <div class="section">
    <h2 class="section-title mono">ACTIVE CAPABILITIES</h2>
    <div class="card-list">
      {#each capabilities as c}
        <div class="card">
          <div class="card-header">
            <h3 class="card-name">{c.name}</h3>
            <span class="status-dot" class:active={c.status === "active"}></span>
          </div>
          <p class="card-desc">{c.description}</p>
        </div>
      {/each}
    </div>
  </div>

  <div class="section">
    <h2 class="section-title mono">DERIVABLE IN FUTURE</h2>
    <p class="section-note">
      These features require no new client-side instrumentation — they are derivable from data the system already collects.
    </p>
    <div class="card-list">
      {#each futureFeatures as f}
        <div class="card future">
          <h3 class="card-name">{f.name}</h3>
          <p class="card-desc">{f.description}</p>
        </div>
      {/each}
    </div>
  </div>

  {#if data.health}
    <div class="section">
      <h2 class="section-title mono">SYSTEM</h2>
      <p class="card-desc">
        Backend: {data.health.ok ? "healthy" : "unreachable"} · Latency: <span class="mono">{data.health.latencyMs}ms</span>
      </p>
    </div>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xl);
    max-width: 860px;
  }

  .page-title {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--c-text-muted);
  }

  .subtitle {
    font-size: 0.9rem;
    color: var(--c-text-muted);
    margin-top: calc(-1 * var(--sp-lg));
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .section-title {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--c-accent);
    border-bottom: 1px solid var(--c-border);
    padding-bottom: var(--sp-sm);
  }

  .section-note {
    font-size: 0.8rem;
    color: var(--c-text-muted);
    font-style: italic;
  }

  .card-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    padding: var(--sp-md);
  }

  .card.future {
    border-left: 2px solid var(--c-text-muted);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--c-text);
    margin-bottom: var(--sp-xs);
  }

  .card-desc {
    font-size: 0.8rem;
    color: var(--c-text-muted);
    line-height: 1.5;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    background: var(--c-text-muted);
  }

  .status-dot.active {
    background: var(--c-ok);
  }
</style>
