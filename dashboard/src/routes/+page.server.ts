import type { PageServerLoad } from "./$types";
import { fetchHealth, fetchMetrics } from "$lib/api";

export const load: PageServerLoad = async ({ fetch, request }) => {
  const cookieHeader = request.headers.get("cookie");
  const [health, metrics] = await Promise.all([
    fetchHealth(fetch),
    fetchMetrics(fetch, cookieHeader),
  ]);

  return { health, metrics };
};
