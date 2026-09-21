// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment, type ReactNode } from "react";
import { recordFormRows, type Form, type FormAnswers } from "@openlaw/shared";

export function RecordRows({
  form,
  answers,
  builtins,
  fields,
}: Readonly<{
  form: Form | undefined;
  answers: FormAnswers;
  builtins: Record<string, ReactNode>;
  fields: readonly { slug: string; control: ReactNode }[];
}>) {
  const controls = new Map([
    ...Object.entries(builtins),
    ...fields.map((f) => [f.slug, f.control] as const),
  ]);
  const order = form ? recordFormRows(form, answers).map((r) => r.rowRef) : [...controls.keys()];
  return (
    <>
      {order.map((key) => (
        <Fragment key={key}>{controls.get(key)}</Fragment>
      ))}
    </>
  );
}
