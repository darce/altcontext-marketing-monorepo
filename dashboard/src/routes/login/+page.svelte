<script lang="ts">
  import type { PageData } from "./$types";

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<svelte:head>
  <title>Login - AltContext</title>
</svelte:head>

<section class="login-shell">
  <form class="login-card" method="POST" action="/v1/auth/login">
    <h1 class="title mono">DASHBOARD LOGIN</h1>

    {#if data.error === "invalid_credentials"}
      <p class="error" role="alert">Invalid email or password.</p>
    {/if}

    <label class="field">
      <span>Tenant Slug</span>
      <input
        name="tenantSlug"
        type="text"
        required
        autocomplete="organization"
        placeholder="tenant-slug"
      />
    </label>

    <label class="field">
      <span>Email</span>
      <input name="email" type="email" required autocomplete="username" />
    </label>

    <label class="field">
      <span>Password</span>
      <input
        name="password"
        type="password"
        required
        autocomplete="current-password"
      />
    </label>

    <button type="submit">Sign in</button>
  </form>
</section>

<style>
  .login-shell {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: var(--sp-lg);
  }

  .login-card {
    width: min(100%, 420px);
    display: grid;
    gap: var(--sp-md);
    padding: var(--sp-lg);
    border: 1px solid var(--c-border);
    background: var(--c-surface);
  }

  .title {
    margin: 0;
    font-size: 0.9rem;
    letter-spacing: 0.15em;
    color: var(--c-text-muted);
  }

  .field {
    display: grid;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--c-text-muted);
  }

  input {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--c-border);
    background: var(--c-bg);
    color: var(--c-text);
  }

  button {
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--c-border);
    background: var(--c-accent);
    color: var(--c-bg);
    font-weight: 600;
    cursor: pointer;
  }

  .error {
    margin: 0;
    color: #ff7a7a;
    font-size: 0.85rem;
  }
</style>
