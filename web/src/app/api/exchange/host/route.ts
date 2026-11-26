import { after } from "next/server";
import { getHostReports, onchainHost } from "@/lib/server/host";
import { handle, json } from "@/lib/server/http";

// The advisor call runs after the response (after()), so give the function room to finish it.
export const maxDuration = 60;

const chain = onchainHost();

/**
 * Public, read-only: host agent reports for AgentDealsV2 deals, ?ids=1,2 (max 20).
 * { dealId, phase, alarms: [{ code, level, n? }], advisor: { status, opinion? }, indexedTo }.
 * The host agent only advises and warns: it holds no key and cannot change any deal. No wallet addresses are returned.
 */
export async function GET(req: Request) {
  return handle(async (db) => json(await getHostReports(db, new URL(req.url).searchParams.get("ids"), { chain, schedule: (job) => after(job) })));
}
