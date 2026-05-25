import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL es obligatoria")
    .refine(
      (value) =>
        !value.includes("YOUR_PASSWORD") &&
        !value.includes("[YOUR-PASSWORD]") &&
        !value.includes("[TU_PASSWORD]"),
      "DATABASE_URL aun tiene password placeholder. Reemplazala con tu password real de Supabase.",
    ),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("documentos"),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.coerce.boolean().default(true),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  MAIL_FROM: z.string().min(1).default("PaperHub <onboarding@resend.dev>"),
  APP_URL: z.string().url().default("http://localhost:4200"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Variables de entorno inválidas:");
  console.error(parsedEnv.error.flatten().fieldErrors);
  throw new Error("Config de entorno inválida");
}

export const env = parsedEnv.data;
