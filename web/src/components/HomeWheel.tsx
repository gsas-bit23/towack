"use client";

import { SpinWheel } from "./SpinWheel";

/** Decorative attract-mode wheel for the home page (slow drift, still under reduced motion). */
export function HomeWheel() {
  return (
    <div className="relative">
      <SpinWheel mode="attract" size={420} />
      <p className="mt-3 text-center text-sm font-black text-navy/60">Slices are widened for readability. Real odds: see the deck below.</p>
    </div>
  );
}
