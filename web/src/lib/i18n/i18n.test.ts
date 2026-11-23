import { describe, expect, it } from "vitest";
import { MESSAGES } from "./dictionaries";
import { common } from "./messages/common";
import { draw } from "./messages/draw";
import { home } from "./messages/home";
import { mint } from "./messages/mint";
import { pages } from "./messages/pages";
import { perps } from "./messages/perps";
import { trade } from "./messages/trade";
import { stripTags } from "./rich";
import { htmlLang, interpolate, isLocale, makeT, translate, type MessageKey } from "./translate";

const TABLES = { common, home, mint, draw, trade, perps, pages };
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();

describe("translate / t()", () => {
  it("returns English and Simplified Chinese for the same key", () => {
    expect(translate("en", "nav.mint")).toBe("Mint");
    expect(translate("zh", "nav.mint")).toBe("铸造");
    expect(makeT("zh")("wallet.connect")).toBe("连接钱包");
    expect(makeT("en")("wallet.connect")).toBe("Connect wallet");
  });

  it("interpolates variables in both locales", () => {
    expect(translate("en", "mint.btn.vrf", { fee: "0.0004 BNB" })).toBe("Mint for 0.1 BNB + 0.0004 BNB VRF fee");
    expect(translate("zh", "mint.btn.vrf", { fee: "0.0004 BNB" })).toBe("支付 0.1 BNB + 0.0004 BNB VRF 费用铸造");
    expect(translate("zh", "home.feat.remaining", { n: 4_321 })).toBe("剩余 4321");
  });

  it("leaves unknown placeholders visible and ignores missing vars", () => {
    expect(interpolate("a {x} b {y}", { x: 1 })).toBe("a 1 b {y}");
    expect(interpolate("no vars")).toBe("no vars");
  });

  it("falls back to the key for unknown (dynamic) keys instead of crashing", () => {
    expect(translate("zh", "does.not.exist" as MessageKey)).toBe("does.not.exist");
    expect(translate("en", "tx.err.SomethingNew")).toBe("tx.err.SomethingNew");
  });

  it("keeps the critical Genesis copy faithful", () => {
    expect(translate("en", "genesis.cost")).toBe("Completely free — only network gas (~$0.002), instant 20,000 TWAK");
    expect(translate("zh", "genesis.cost")).toBe("完全免费 — 仅需链上 Gas 费（约 $0.002），立得 20,000 TWAK");
    expect(translate("zh", "home.path.launchBody")).toContain("Chainlink VRF");
  });

  it("maps locales to html lang", () => {
    expect(htmlLang("en")).toBe("en");
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("strips rich tags for plain text", () => {
    expect(stripTags(translate("en", "home.router.body"))).not.toMatch(/<\/?b>/);
  });
});

describe("dictionary integrity", () => {
  it("has no key defined in two message modules (spreads would silently override)", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [name, table] of Object.entries(TABLES)) {
      for (const key of Object.keys(table)) {
        if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} + ${name})`);
        seen.set(key, name);
      }
    }
    expect(dupes).toEqual([]);
    expect(Object.keys(MESSAGES).length).toBe(seen.size);
  });

  const entries = Object.entries(MESSAGES) as [string, readonly [string, string]][];

  it("has a non-empty English and Chinese string for every key", () => {
    const empty = entries.filter(([, [en, zh]]) => !en.trim() || !zh.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("uses the same {placeholders} in English and Chinese", () => {
    const bad = entries.filter(([, [en, zh]]) => placeholders(en).join() !== placeholders(zh).join()).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("uses the same <tags> in English and Chinese", () => {
    const bad = entries.filter(([, [en, zh]]) => tags(en).join() !== tags(zh).join()).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("keeps proper nouns intact in Chinese wherever English uses them", () => {
    const NOUNS = ["TWAK", "Agent ID", "Chainlink VRF", "PancakeSwap", "Genesis 300", "Draw V2", "TowackRouter", "@towackxyz"];
    const bad: string[] = [];
    for (const [k, [en, zh]] of entries) for (const n of NOUNS) if (en.includes(n) && !zh.includes(n)) bad.push(`${k}: ${n}`);
    expect(bad).toEqual([]);
  });
});
