import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import { SCHEMA } from "./schema";
import type { Db } from "./db";
import { EVIDENCE_MAX, getEvidence, putEvidence, type DealHashReader } from "./evidence";
import { ExchangeError } from "./exchange";

const ZERO = `0x${"0".repeat(64)}` as Hex;
const h = (s: string) => keccak256(toBytes(s));

async function memDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = { query: async (text, params = []) => (await pg.query(text, params as unknown[])).rows as never };
  for (const s of SCHEMA) await db.query(s);
  return db;
}

// Deal 1: delivered; deal 2: funded (not delivered); anything else: missing.
const reader: DealHashReader = async (id) =>
  id === 1n ? { termsHash: h("terms one"), deliveryHash: h("delivered one"), status: 3 } : id === 2n ? { termsHash: h("terms two"), deliveryHash: ZERO, status: 2 } : null;

describe("deal evidence (public judge texts, hash-checked)", () => {
  let db: Db;
  beforeEach(async () => {
    db = await memDb();
  });

  it("stores texts that match the on-chain hashes and serves them publicly", async () => {
    await putEvidence(db, reader, { dealId: "1", terms: "terms one" });
    const e = await putEvidence(db, reader, { dealId: 1, delivery: "delivered one" });
    expect(e).toMatchObject({ dealId: "1", terms: "terms one", delivery: "delivered one" });
    const got = await getEvidence(db, "1,2,1");
    expect(got).toHaveLength(1);
    expect(got[0].terms).toBe("terms one");
  });

  it("rejects forged or mismatched texts", async () => {
    await expect(putEvidence(db, reader, { dealId: "1", terms: "terms one!" })).rejects.toThrow(/termsHash/);
    await expect(putEvidence(db, reader, { dealId: "1", delivery: "something else" })).rejects.toThrow(/deliveryHash/);
    await expect(putEvidence(db, reader, { dealId: "2", delivery: "x" })).rejects.toThrow(/not been delivered/);
    await expect(putEvidence(db, reader, { dealId: "9", terms: "x" })).rejects.toThrow(/no such deal/);
  });

  it("validates input", async () => {
    await expect(putEvidence(db, reader, { dealId: "0", terms: "x" })).rejects.toBeInstanceOf(ExchangeError);
    await expect(putEvidence(db, reader, { dealId: "abc", terms: "x" })).rejects.toBeInstanceOf(ExchangeError);
    await expect(putEvidence(db, reader, { dealId: "1" })).rejects.toThrow(/terms and\/or delivery/);
    await expect(putEvidence(db, reader, { dealId: "1", terms: "a".repeat(EVIDENCE_MAX + 1) })).rejects.toThrow(/too long/);
    await expect(getEvidence(db, Array.from({ length: 101 }, (_, i) => i + 1).join(","))).rejects.toThrow(/at most 100/);
    expect(await getEvidence(db, null)).toEqual([]);
  });

  it("keeps the other text when only one is updated", async () => {
    await putEvidence(db, reader, { dealId: "1", terms: "terms one" });
    await putEvidence(db, reader, { dealId: "1", delivery: "delivered one" });
    const [e] = await getEvidence(db, "1");
    expect(e.terms).toBe("terms one");
    expect(e.delivery).toBe("delivered one");
  });
});
