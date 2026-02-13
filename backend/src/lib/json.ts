import type { Prisma } from "@prisma/client";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isInputJsonValue = (value: unknown): value is Prisma.InputJsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isInputJsonValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every(
      (entry) => entry !== undefined && isInputJsonValue(entry),
    );
  }

  return false;
};

export const toPrismaJson = (
  value: unknown,
): Prisma.InputJsonValue | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const cloned = structuredClone(value);
  if (!isInputJsonValue(cloned)) {
    throw new TypeError("value is not serializable to Prisma.InputJsonValue");
  }

  return cloned;
};
