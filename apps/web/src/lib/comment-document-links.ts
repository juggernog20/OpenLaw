// SPDX-License-Identifier: AGPL-3.0-only

/** Document references use ordinary internal Markdown links in the stored comment body. */
export interface CommentDocumentLink {
  displayName: string;
  href: string;
}

export type CommentBodyPart = string | CommentDocumentLink;

function isDocumentHref(href: string): boolean {
  return /^\/(?:(?:contracts|matters)\/\d+\/documents|entities\/[\w%-]+\/documents|knowledge\/[\w%-]+)\?doc=[\w%-]+&version=[\w%-]+$/.test(
    href,
  );
}

export function commentBodyParts(body: string): CommentBodyPart[] {
  const pattern = /\[@((?:\\[^\n]|[^\]\\\n])+)\]\(([^\s)]+)\)/g;
  const parts: CommentBodyPart[] = [];
  let at = 0;
  for (const match of body.matchAll(pattern)) {
    if (!isDocumentHref(match[2]!)) continue;
    parts.push(body.slice(at, match.index));
    parts.push({ displayName: match[1]!.replace(/\\([\\[\]])/g, "$1"), href: match[2]! });
    at = match.index + match[0].length;
  }
  parts.push(body.slice(at));
  return parts;
}

export function documentLinkDraft(body: string) {
  const parts = commentBodyParts(body);
  return {
    draft: parts.map((part) => (typeof part === "string" ? part : `@${part.displayName}`)).join(""),
    links: parts.filter((part): part is CommentDocumentLink => typeof part !== "string"),
  };
}

export function serializeDocumentLinks(
  draft: string,
  links: readonly CommentDocumentLink[],
): string {
  const byName = new Map(
    links.filter((link) => isDocumentHref(link.href)).map((link) => [link.displayName, link]),
  );
  if (byName.size === 0) return draft;
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(^|\\s)@(${escaped.join("|")})(?=$|\\s|[.,!?;:])`, "g");
  return draft.replace(pattern, (_match, space: string, name: string) => {
    const link = byName.get(name)!;
    const label = name.replace(/[\\[\]]/g, "\\$&");
    return `${space}[@${label}](${link.href})`;
  });
}
