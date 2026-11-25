import { exchangeStats } from "@/lib/server/exchange";
import { handle, json } from "@/lib/server/http";

/** Live Exchange numbers for the dashboard. */
export async function GET() {
  return handle(async (db) => json(await exchangeStats(db)));
}
