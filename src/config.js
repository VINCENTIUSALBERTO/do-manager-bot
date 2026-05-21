import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be a 32-byte hex string (64 chars)'),
  ALLOWED_USER_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n)),
    ),
  ADMIN_USER_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n)),
    ),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  NODE_ENV: z.string().default('development'),
  EXPIRY_CRON: z.string().default('*/1 * * * *'),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
