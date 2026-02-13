import { z } from "zod";

import { env } from "../config/env.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const parseIsoDay = (value: string): Date => {
  if (!ISO_DAY_PATTERN.test(value)) {
    throw new Error("invalid_date_format");
  }

  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("invalid_date_value");
  }

  return parsed;
};

const compareToSchema = z
  .preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
      }
    }

    return value;
  }, z.boolean())
  .optional()
  .default(false);

const isoDaySchema = z
  .string()
  .trim()
  .regex(ISO_DAY_PATTERN)
  .transform((value, context) => {
    try {
      return parseIsoDay(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid ISO day value",
      });
      return z.NEVER;
    }
  });

export const summaryQuerySchema = z
  .object({
    from: isoDaySchema,
    to: isoDaySchema,
    propertyId: z.string().trim().min(1).max(128).optional(),
    compareTo: compareToSchema,
  })
  .superRefine((value, context) => {
    if (value.from.getTime() > value.to.getTime()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from must be less than or equal to to",
        path: ["from"],
      });
      return;
    }

    const dayCount =
      Math.floor((value.to.getTime() - value.from.getTime()) / DAY_MS) + 1;
    if (dayCount > 366) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date window cannot exceed 366 days",
        path: ["to"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    propertyId: value.propertyId ?? env.ROLLUP_DEFAULT_PROPERTY_ID,
  }));

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

export const formatIsoDay = (value: Date): string =>
  value.toISOString().slice(0, 10);

export const addUtcDays = (value: Date, days: number): Date =>
  new Date(value.getTime() + days * DAY_MS);

export const dayDiffInclusive = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;

export const startOfUtcDay = (value: Date): Date =>
  new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
