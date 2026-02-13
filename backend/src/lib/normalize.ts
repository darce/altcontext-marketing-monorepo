export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export const toEmailDomain = (email: string): string | null => {
  const [, domain] = normalizeEmail(email).split("@");
  return domain && domain.length > 0 ? domain : null;
};
