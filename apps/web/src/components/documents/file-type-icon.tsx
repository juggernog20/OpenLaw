// SPDX-License-Identifier: AGPL-3.0-only

/** A document-shaped format badge; no file contents need to be loaded. */
export function FileTypeIcon({ filename }: Readonly<{ filename: string }>) {
  const extension = filename.includes(".") ? (filename.split(".").at(-1)?.toLowerCase() ?? "") : "";
  const tone =
    extension === "pdf"
      ? "text-status-danger-fg"
      : ["doc", "docx", "rtf", "odt"].includes(extension)
        ? "text-status-info-fg"
        : ["xls", "xlsx", "csv", "ods"].includes(extension)
          ? "text-status-success-fg"
          : ["ppt", "pptx", "odp"].includes(extension)
            ? "text-status-warning-fg"
            : "text-muted";
  const label = extension && extension.length <= 5 ? extension.toUpperCase() : "FILE";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 72"
      className={`h-full max-h-14 w-auto max-w-full ${tone}`}
      fill="none"
    >
      <path
        d="M14 3h25l13 13v48a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z"
        className="fill-raised"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.35"
      />
      <path
        d="M39 3v11a3 3 0 0 0 3 3h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.35"
      />
      <path
        d="M19 27h23M19 33h17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.25"
      />
      <rect x="3" y="40" width="55" height="23" rx="4" fill="currentColor" fillOpacity="0.12" />
      <text
        x="30.5"
        y="55"
        textAnchor="middle"
        fill="currentColor"
        fontSize={label.length > 4 ? 10 : 12}
        fontWeight="700"
        letterSpacing="0.5"
      >
        {label}
      </text>
    </svg>
  );
}
