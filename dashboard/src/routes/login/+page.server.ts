import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => ({
  error: url.searchParams.get("error"),
});
