/// <reference types="@sveltejs/kit" />

declare namespace App {
  interface Error {
    message: string;
  }

  interface User {
    id: string;
    email: string;
    name: string | null;
    role: string;
  }

  interface Tenant {
    id: string;
    name: string;
    slug: string;
  }

  interface Locals {
    user?: User;
    tenant?: Tenant;
  }
}
