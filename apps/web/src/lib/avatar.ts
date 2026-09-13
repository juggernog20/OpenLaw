// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The photo a person can upload for themselves: JPG or PNG, 1 MB max
 * (ST1). It matches the API's cap on the data: URI, so the Profile pane
 * and the Portal first run refuse the same files.
 */

export const AVATAR_BYTE_LIMIT = 1024 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg"];
