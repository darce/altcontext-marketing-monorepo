import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const boolFromString = (value: string): boolean =>
  ["1", "true", "yes", "on"].includes(value.toLowerCase());

const csvToList = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1),
  IP_HASH_PEPPER: z.string().min(16),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_TIME_WINDOW: z.string().min(1).default("1 minute"),
  SESSION_INACTIVITY_MINUTES: z.coerce.number().int().min(1).default(30),
  HEURISTIC_LINK_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  ENABLE_HEURISTIC_LINKING: z
    .string()
    .default("true")
    .transform(boolFromString),
  CORS_ALLOWED_ORIGINS: z.string().default("").transform(csvToList),
  ADMIN_API_KEY: z.string().min(24).optional(),
  PRIVACY_CONTACT_EMAIL: z.string().email().default("privacy@altcontext.local"),
});

export type Environment = z.infer<typeof environmentSchema>;

export const parseEnvironment = (
  rawEnv: NodeJS.ProcessEnv = process.env,
): Environment => environmentSchema.parse(rawEnv);

export const env = parseEnvironment();
