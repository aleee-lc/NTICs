import { Pool } from "pg";
import { env } from "./env";

const parsedUrl = new URL(env.DATABASE_URL);
const isLocalDatabase =
  parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";

if (!isLocalDatabase) {
  // `pg` can enforce stricter cert validation when sslmode is present in the URL.
  // We control TLS settings through the explicit `ssl` option below.
  parsedUrl.searchParams.delete("sslmode");
}

export const pool = new Pool({
  connectionString: parsedUrl.toString(),
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});
