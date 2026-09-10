// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";

export const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
export const CurrencySchema = z.string().trim().transform((code) => code.toUpperCase()).refine(
  (code) => ISO_CURRENCIES.has(code), { message: "Choose a valid currency." },
);
