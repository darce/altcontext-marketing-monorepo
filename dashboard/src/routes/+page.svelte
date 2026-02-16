<script lang="ts">
  import HealthIndicator from "$lib/components/HealthIndicator.svelte";
  import type { PageData } from "./$types";

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Dashboard — AltContext</title>
</svelte:head>

<section class="page">
  <h1 class="page-title mono">SYSTEM STATUS</h1>

  <div class="grid">
    <HealthIndicator status={data.health} />
  </div>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-lg);
  }

  .page-title {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--c-text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--sp-md);
  }
</style>
