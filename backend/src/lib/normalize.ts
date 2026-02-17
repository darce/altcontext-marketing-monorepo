export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/** @deprecated Use DB-generated `leads.email_domain` instead of app-side derivation. */
// ts-prune-ignore-next
export const toEmailDomain = (email: string): string | null => {
  const [, domain] = normalizeEmail(email).split("@");
  return domain && domain.length > 0 ? domain : null;
};
