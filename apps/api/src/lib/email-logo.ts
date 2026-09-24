// SPDX-License-Identifier: AGPL-3.0-only

import sharp from "sharp";
import { and, eq, isNull, orgSettings, type Db } from "@openlaw/db";
import { LOGO_BYTE_LIMIT } from "@openlaw/shared";

/** DES-093: store PNG bytes as base64, without a data URI prefix. */
export async function makeEmailLogo(logo: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo);
  if (!match || Buffer.byteLength(match[2]!, "base64") > LOGO_BYTE_LIMIT) {
    throw new Error("Invalid logo data URI");
  }
  const image = sharp(Buffer.from(match[2]!, "base64"), { limitInputPixels: 16_000_000 });
  const metadata = await image.metadata();
  const expected = match[1] === "svg+xml" ? "svg" : match[1];
  if (metadata.format !== expected) throw new Error("Logo format does not match its MIME type");
  const png = await image
    .rotate()
    .resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .timeout({ seconds: 5 })
    .toBuffer();
  return png.toString("base64");
}

/** Run after migrations. A saved copy makes later starts a no-op. */
export async function backfillEmailLogo(db: Db): Promise<"created" | "unchanged" | "invalid"> {
  const [row] = await db
    .select({ id: orgSettings.id, logo: orgSettings.logo })
    .from(orgSettings)
    .where(isNull(orgSettings.emailLogoPng))
    .limit(1);
  if (!row?.logo) return "unchanged";
  let emailLogoPng: string;
  try {
    emailLogoPng = await makeEmailLogo(row.logo);
  } catch {
    // Older uploads checked the data URI but did not decode the image.
    return "invalid";
  }
  const changed = await db
    .update(orgSettings)
    .set({ emailLogoPng })
    .where(
      and(
        eq(orgSettings.id, row.id),
        eq(orgSettings.logo, row.logo),
        isNull(orgSettings.emailLogoPng),
      ),
    )
    .returning({ id: orgSettings.id });
  // A concurrent upload or clear must win over the old image we decoded.
  return changed.length ? "created" : "unchanged";
}
