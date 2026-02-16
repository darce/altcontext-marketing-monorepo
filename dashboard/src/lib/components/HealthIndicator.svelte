<!--
  HealthIndicator.svelte

  Displays backend health status with latency.
  Pure presentational — receives data via props.
-->
<script lang="ts">
  import type { HealthStatus } from "$lib/api";

  interface Props {
    status: HealthStatus;
  }

  let { status }: Props = $props();

  const label = $derived(status.ok ? "HEALTHY" : "DOWN");
  const color = $derived(status.ok ? "var(--c-ok)" : "var(--c-err)");
</script>

<div class="health-card">
  <div class="header">
    <span class="dot" style:background={color}></span>
    <span class="label mono" style:color={color}>{label}</span>
  </div>

  <dl class="details">
    <div class="detail-row">
      <dt>Service</dt>
      <dd class="mono">{status.service}</dd>
    </div>
    <div class="detail-row">
      <dt>Latency</dt>
      <dd class="mono">{status.latencyMs}ms</dd>
    </div>
    <div class="detail-row">
      <dt>Checked</dt>
      <dd class="mono">{new Date(status.timestamp).toLocaleTimeString()}</dd>
    </div>
  </dl>
</div>

<style>
  .health-card {
    border: 1px solid var(--c-border);
    background: var(--c-surface);
    padding: var(--sp-md);
    max-width: 320px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-md);
  }

  .dot {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  .label {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  dt {
    font-size: 0.75rem;
    color: var(--c-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  dd {
    font-size: 0.8rem;
    color: var(--c-text);
  }
</style>
