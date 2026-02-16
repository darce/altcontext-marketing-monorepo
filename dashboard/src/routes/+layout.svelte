<script lang="ts">
  import "../app.css";

  interface Props {
    children: import("svelte").Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="shell">
  <header class="topbar">
    <span class="logo mono">ALTCONTEXT</span>
    <nav>
      <a href="/" class="nav-link">Dashboard</a>
      <a href="/capabilities" class="nav-link">Capabilities</a>
    </nav>
  </header>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 100dvh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--sp-lg);
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--c-border);
    background: var(--c-surface);
  }

  .logo {
    font-size: 0.75rem;
    letter-spacing: 0.15em;
    color: var(--c-accent);
    font-weight: 700;
  }

  .nav-link {
    font-size: 0.8rem;
    color: var(--c-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .nav-link:hover {
    color: var(--c-text);
    text-decoration: none;
  }

  .content {
    padding: var(--sp-lg);
  }
</style>
