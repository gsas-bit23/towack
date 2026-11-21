#!/usr/bin/env python3
"""Viewport audit for the Towack Arcade Sky frontend.

Usage:
  python3 web/scripts/responsive-audit.py --base http://127.0.0.1:3126 --out web/shots/responsive/before
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

VIEWPORTS = [
    ("iphone-se", 375, 667, True),
    ("iphone-14", 390, 844, True),
    ("pixel", 412, 915, True),
    ("android-sm", 360, 740, True),
    ("ipad-portrait", 768, 1024, True),
    ("ipad-landscape", 1024, 768, False),
    ("ipad-pro", 1024, 1366, True),
    ("mac-1280", 1280, 800, False),
    ("mac-1440", 1440, 900, False),
    ("mac-1512", 1512, 982, False),
    ("desktop-1920", 1920, 1080, False),
]

# Static routes plus the demo wheel (spin + land).
ROUTES = [
    ("home", "/"),
    ("mint", "/mint"),
    ("mint-demo", "/mint?demo=wheel"),
    ("draw", "/draw"),
    ("trade", "/trade"),
    ("rebates", "/rebates"),
    ("tokenomics", "/tokenomics"),
    ("lottery", "/lottery"),
    ("docs", "/docs"),
]

CHECK_JS = r"""
() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const doc = document.documentElement;
  const issues = [];
  const tol = 1;

  const scrollW = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  if (scrollW > vw + tol) {
    issues.push({
      type: "horizontal-overflow",
      detail: `document.scrollWidth ${scrollW} > innerWidth ${vw}`,
      scrollWidth: scrollW,
      innerWidth: vw,
    });
  }

  const skip = (el) => {
    if (!el || el.nodeType !== 1) return true;
    if (el.closest("nextjs-portal, [data-nextjs-dialog], [data-nextjs-toast]")) return true;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return true;
    return false;
  };

  const desc = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = (el.className && typeof el.className === "string")
      ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".")
      : "";
    const text = (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return `${tag}${id}${cls}${text ? ' "' + text + '"' : ""}`;
  };

  // Elements overflowing the viewport horizontally (layout overflow, not off-screen decorations far below).
  const all = Array.from(document.querySelectorAll("body *"));
  for (const el of all) {
    if (skip(el)) continue;
    const st = getComputedStyle(el);
    // Absolute/fixed decorative art is allowed to sit slightly outside rounded stages,
    // but not to widen the page. Flag if it extends past the viewport AND the document is overflowing
    // or the element itself is in normal flow / large.
    const r = el.getBoundingClientRect();
    const pageLeft = r.left + window.scrollX;
    const pageRight = r.right + window.scrollX;
    if (pageLeft < -tol || pageRight > vw + tol) {
      const overflowAmt = Math.max(-pageLeft, pageRight - vw);
      if (overflowAmt < 2) continue;
      issues.push({
        type: "element-overflow-x",
        el: desc(el),
        left: Math.round(pageLeft * 10) / 10,
        right: Math.round(pageRight * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        overflow: Math.round(overflowAmt * 10) / 10,
        position: st.position,
      });
    }
  }

  // Overlapping sibling text / buttons / links (not parent-child, not decorative aria-hidden).
  const interesting = all.filter((el) => {
    if (skip(el)) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const tag = el.tagName;
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|H1|H2|H3|H4|P|LI)$/.test(tag)) return true;
    if (el.getAttribute("role") === "button" || el.getAttribute("role") === "radio") return true;
    return false;
  });

  const overlapArea = (a, b) => {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  };

  const seenPairs = new Set();
  for (let i = 0; i < interesting.length; i++) {
    const a = interesting[i];
    const ra = a.getBoundingClientRect();
    for (let j = i + 1; j < interesting.length; j++) {
      const b = interesting[j];
      if (a.contains(b) || b.contains(a)) continue;
      // Only siblings or near-siblings in the same section — skip if one is a descendant of a shared button/link.
      if (a.parentElement !== b.parentElement) continue;
      const rb = b.getBoundingClientRect();
      const area = overlapArea(ra, rb);
      if (area < 16) continue; // 4x4 px
      const key = [desc(a), desc(b)].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      issues.push({
        type: "sibling-overlap",
        a: desc(a),
        b: desc(b),
        area: Math.round(area),
      });
    }
  }

  // Text clipped by overflow:hidden
  for (const el of all) {
    if (skip(el)) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    const st = getComputedStyle(el);
    if (!(st.overflowX === "hidden" || st.overflow === "hidden" || st.overflow === "clip")) continue;
    if (el.scrollWidth > el.clientWidth + 2 && (el.innerText || "").trim()) {
      issues.push({
        type: "text-clipped",
        el: desc(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }
    if ((st.overflowY === "hidden" || st.overflow === "hidden" || st.overflow === "clip")
        && el.scrollHeight > el.clientHeight + 2 && (el.innerText || "").trim()) {
      // Ignore intentionally scroll-boxed areas taller than a screen
      if (el.scrollHeight - el.clientHeight < 4) continue;
      // Many cards clip via overflow-hidden rounded containers that still show all text
      // (scrollHeight can exceed due to shadows/descenders). Only flag if text overflows visibly
      // by a meaningful amount AND there is no wrap room.
      if (el.scrollHeight > el.clientHeight + 12 && st.whiteSpace === "nowrap") {
        issues.push({
          type: "text-clipped-y",
          el: desc(el),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        });
      }
    }
  }

  return issues;
}
"""

TAP_JS = r"""
() => {
  const issues = [];
  const els = document.querySelectorAll("a, button, input, select, textarea, [role='button'], [role='radio'], [role='tab']");
  const desc = (el) => {
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const cls = (el.className && typeof el.className === "string")
      ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
      : "";
    return `${tag}${cls}${text ? ' "' + text + '"' : ""}`;
  };
  for (const el of els) {
    if (el.closest("nextjs-portal")) continue;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const w = Math.round(r.width * 10) / 10;
    const h = Math.round(r.height * 10) / 10;
    if (w < 40 || h < 40) {
      issues.push({
        type: "tap-target-small",
        el: desc(el),
        width: w,
        height: h,
      });
    }
  }
  return issues;
}
"""


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def run_checks(page, mobile: bool) -> list[dict]:
    issues = page.evaluate(CHECK_JS)
    if mobile:
        issues.extend(page.evaluate(TAP_JS))
    return issues


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3126")
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", default="before")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    report: dict = {
        "label": args.label,
        "base": args.base,
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pages": [],
        "summary": {},
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox", "--disable-gpu"],
        )
        for name, w, h, mobile in VIEWPORTS:
            print(f"== {name} {w}x{h} mobile={mobile} ==", flush=True)
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=1,
                is_mobile=mobile,
                has_touch=mobile,
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                    if mobile and w < 600
                    else None
                ),
            )
            page = ctx.new_page()
            page.add_init_script(
                """document.addEventListener('DOMContentLoaded', () => {
                  const s = document.createElement('style');
                  s.textContent = 'nextjs-portal, [data-nextjs-toast] { display: none !important; }';
                  document.head.appendChild(s);
                });"""
            )
            for route_name, path in ROUTES:
                url = args.base + path
                entry = {
                    "device": name,
                    "viewport": [w, h],
                    "route": route_name,
                    "path": path,
                    "shots": [],
                    "issues": [],
                }
                try:
                    page.goto(url, wait_until="networkidle", timeout=30_000)
                    page.wait_for_timeout(700)
                    if route_name == "mint-demo":
                        mid = out / f"{name}__mint-demo-spin.png"
                        page.screenshot(path=str(mid), full_page=True)
                        entry["shots"].append(str(mid))
                        try:
                            page.get_by_text("Demo landed on").wait_for(timeout=15_000)
                            page.wait_for_timeout(600)
                        except Exception as e:
                            entry["issues"].append({"type": "demo-land-timeout", "detail": str(e)})
                            page.wait_for_timeout(8000)
                        shot = out / f"{name}__mint-demo-landed.png"
                        page.screenshot(path=str(shot), full_page=True)
                        entry["shots"].append(str(shot))
                    else:
                        shot = out / f"{name}__{slug(route_name)}.png"
                        page.screenshot(path=str(shot), full_page=True)
                        entry["shots"].append(str(shot))
                    entry["issues"].extend(run_checks(page, mobile))

                    # Header close-up on home (nav + connect).
                    if route_name == "home":
                        fold = out / f"{name}__home-fold.png"
                        page.evaluate("window.scrollTo(0,0)")
                        page.wait_for_timeout(150)
                        page.screenshot(path=str(fold), full_page=False)
                        entry["shots"].append(str(fold))
                        # Footer close-up
                        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        page.wait_for_timeout(200)
                        foot = out / f"{name}__home-footer.png"
                        page.screenshot(path=str(foot), full_page=False)
                        entry["shots"].append(str(foot))
                        page.evaluate("window.scrollTo(0,0)")
                except Exception as e:
                    entry["issues"].append({"type": "audit-error", "detail": str(e)})
                report["pages"].append(entry)
                n_iss = len([i for i in entry["issues"] if i.get("type") != "audit-error"])
                print(f"  {route_name}: {n_iss} issues, shots={len(entry['shots'])}", flush=True)
            ctx.close()
        browser.close()

    # Summaries
    by_type: dict[str, int] = {}
    by_device: dict[str, int] = {}
    for page in report["pages"]:
        for iss in page["issues"]:
            t = iss.get("type", "?")
            by_type[t] = by_type.get(t, 0) + 1
            by_device[page["device"]] = by_device.get(page["device"], 0) + 1
    report["summary"] = {
        "pages": len(report["pages"]),
        "total_issues": sum(len(p["issues"]) for p in report["pages"]),
        "by_type": by_type,
        "by_device": by_device,
        "finished": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    # Compact text report
    lines = [
        f"# Responsive audit ({args.label})",
        f"Finished {report['summary']['finished']}",
        f"Total issues: {report['summary']['total_issues']}",
        f"By type: {json.dumps(by_type)}",
        f"By device: {json.dumps(by_device)}",
        "",
    ]
    # Deduped issue signatures
    sigs: dict[str, list[str]] = {}
    for page in report["pages"]:
        loc = f"{page['device']} {page['route']}"
        for iss in page["issues"]:
            t = iss.get("type")
            if t == "element-overflow-x":
                key = f"{t}: {iss.get('el')} overflow={iss.get('overflow')}px"
            elif t == "sibling-overlap":
                key = f"{t}: {iss.get('a')} × {iss.get('b')}"
            elif t == "tap-target-small":
                key = f"{t}: {iss.get('el')} {iss.get('width')}x{iss.get('height')}"
            elif t == "text-clipped":
                key = f"{t}: {iss.get('el')}"
            elif t == "horizontal-overflow":
                key = f"{t}: {iss.get('detail')}"
            else:
                key = f"{t}: {iss}"
            sigs.setdefault(key, []).append(loc)
    lines.append(f"Unique signatures: {len(sigs)}")
    lines.append("")
    for key, locs in sorted(sigs.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        lines.append(f"- [{len(locs)}] {key}")
        # show up to 8 locations
        lines.append(f"    {', '.join(locs[:8])}{' …' if len(locs) > 8 else ''}")
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:80]))
    print(f"\nWrote {out / 'report.md'} and report.json")


if __name__ == "__main__":
    main()
