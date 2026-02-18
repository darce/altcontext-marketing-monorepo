<script lang="ts">
  import "../app.css";
  import type { LayoutData } from "./$types";

  interface Props {
    children: import("svelte").Snippet;
    data: LayoutData;
  }

  let { children, data }: Props = $props();
</script>

<div class="shell">
  <header class="topbar">
    <span class="logo mono">ALTCONTEXT</span>
    {#if data.tenant}
      <span class="tenant">{data.tenant.name}</span>
    {/if}
    <nav>
      <a href="/" class="nav-link">Dashboard</a>
      <a href="/capabilities" class="nav-link">Capabilities</a>
    </nav>
    <div class="spacer"></div>
    {#if data.user}
      <span class="user">{data.user.email}</span>
      <form method="POST" action="/logout">
        <button class="logout" type="submit">Logout</button>
      </form>
    {/if}
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

  .tenant {
    font-size: 0.8rem;
    color: var(--c-text-muted);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .user {
    font-size: 0.8rem;
    color: var(--c-text-muted);
  }

  .logout {
    border: 1px solid var(--c-border);
    background: transparent;
    color: var(--c-text);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
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
