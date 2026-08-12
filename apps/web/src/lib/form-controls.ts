// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared class strings for raw form controls (select, textarea) that
 * have no styled component: the C10 field spec — raised surface, 32px
 * tall, 12px text — with the Input's focus ring and disabled treatment
 * (ST8 normalization).
 */

export const CONTROL_CLASS =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link " +
  "disabled:pointer-events-none disabled:opacity-50";

export const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-button border border-border-default bg-raised p-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link " +
  "disabled:pointer-events-none disabled:opacity-50";
