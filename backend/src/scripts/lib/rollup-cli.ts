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
