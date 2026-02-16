import { env } from "../../config/env.js";
import {
  addUtcDays,
  parseIsoDay,
  startOfUtcDay,
} from "../../schemas/metrics.js";

export interface RollupCliArgs {
  from?: string;
  to?: string;
  propertyId?: string;
}

export const parseRollupCliArgs = (argv: string[]): RollupCliArgs => {
  const args: RollupCliArgs = {};

  for (const entry of argv) {
    const [flag, rawValue] = entry.split("=", 2);
    const value = rawValue?.trim();

    if (!value) {
      continue;
    }

    if (flag === "--from") {
      args.from = value;
      continue;
    }

    if (flag === "--to") {
      args.to = value;
      continue;
    }

    if (flag === "--property-id") {
      args.propertyId = value;
      continue;
    }

    throw new Error(
      `unknown argument: ${entry}. Expected --from=YYYY-MM-DD, --to=YYYY-MM-DD, --property-id=<id>`,
    );
  }

  return args;
};

export interface RollupConfig {
  from: Date;
  to: Date;
  propertyId: string;
}

export const getRollupConfig = (args: RollupCliArgs): RollupConfig => {
  const today = startOfUtcDay(new Date());
  const defaultFrom = addUtcDays(today, -(env.ROLLUP_BATCH_DAYS - 1));

  const from = args.from ? parseIsoDay(args.from) : defaultFrom;
  const to = args.to ? parseIsoDay(args.to) : today;
  const propertyId = args.propertyId ?? env.ROLLUP_DEFAULT_PROPERTY_ID;

  if (from.getTime() > to.getTime()) {
    throw new Error("--from must be before or equal to --to");
  }

  return { from, to, propertyId };
};
