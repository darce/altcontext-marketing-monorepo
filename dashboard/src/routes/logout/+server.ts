import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ fetch }) => {
  await fetch("/v1/auth/logout", { method: "POST" });
  redirect(303, "/login");
};
