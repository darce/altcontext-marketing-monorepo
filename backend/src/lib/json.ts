import type { JsonValue } from "./types.js";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isInputJsonValue = (value: unknown): value is JsonValue => {
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

export const toJsonValue = (value: unknown): JsonValue | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const cloned = structuredClone(value);
  if (!isInputJsonValue(cloned)) {
    throw new TypeError("value is not serializable to JsonValue");
  }

  return cloned;
};
