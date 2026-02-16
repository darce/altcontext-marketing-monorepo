import type { PageServerLoad } from "./$types";
import { fetchHealth, fetchMetrics } from "$lib/api";

export const load: PageServerLoad = async ({ fetch }) => {
  const [health, metrics] = await Promise.all([
    fetchHealth(fetch),
    fetchMetrics(fetch),
  ]);

  return { health, metrics };
};
