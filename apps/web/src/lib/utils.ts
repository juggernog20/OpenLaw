// SPDX-License-Identifier: AGPL-3.0-only

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge taught our custom ramps: `text-md` (DES-006's 14px body
 * size) is not in Tailwind's default font-size scale, and without this
 * it would be mis-classified as a text color and dropped when merged
 * with one.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["md"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
