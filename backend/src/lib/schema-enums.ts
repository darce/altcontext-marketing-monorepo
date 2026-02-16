export const ConsentStatus = {
  pending: "pending",
  express: "express",
  implied: "implied",
  withdrawn: "withdrawn",
} as const;
// eslint-disable-next-line no-redeclare
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const LinkSource = {
  form_submit: "form_submit",
  same_ip_ua_window: "same_ip_ua_window",
  manual_merge: "manual_merge",
} as const;
// eslint-disable-next-line no-redeclare
export type LinkSource = (typeof LinkSource)[keyof typeof LinkSource];

export const ValidationStatus = {
  accepted: "accepted",
  rejected: "rejected",
  invalid: "invalid",
} as const;
// eslint-disable-next-line no-redeclare
export type ValidationStatus =
  (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const TrafficSource = {
  direct: "direct",
  organic_search: "organic_search",
  paid_search: "paid_search",
  social: "social",
  email: "email",
  referral: "referral",
  campaign: "campaign",
  internal: "internal",
  unknown: "unknown",
} as const;
// eslint-disable-next-line no-redeclare
export type TrafficSource = (typeof TrafficSource)[keyof typeof TrafficSource];

export const DeviceType = {
  desktop: "desktop",
  mobile: "mobile",
  tablet: "tablet",
  bot: "bot",
  unknown: "unknown",
} as const;
// eslint-disable-next-line no-redeclare
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];
