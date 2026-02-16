import type { PageServerLoad } from "./$types";
import { fetchHealth } from "$lib/api";

export const load: PageServerLoad = async ({ fetch }) => {
  const health = await fetchHealth(fetch);
  return { health };
};
