// SPDX-License-Identifier: AGPL-3.0-only

/** DD-028 routed sections for a type editor, with one navigation strip. */
import { useFormText } from "./type-form/messages";
import type { ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import type { FormModule } from "@openlaw/shared";

export function TypeEditorTabs({
  module,
  typeId,
  name,
}: Readonly<{ module: FormModule; typeId: string; name: string }>) {
  const t = useFormText();
  const root = `/settings/${module === "entity" ? "entities" : `${module}s`}/types/${typeId}`;
  const tabs = [
    ["", t("Details")],
    ["/form", t("Form")],
    ...(module === "contract"
      ? [
          ["/people", t("People")],
          ["/approval", t("Approval defaults")],
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{name}</h2>
      <nav aria-label={t("Type sections")} className="flex border-b border-border-default">
        {tabs.map(([path, label]) => (
          <NavLink
            key={path}
            end
            to={`${root}${path}`}
            className={({ isActive }) =>
              `flex h-9 items-center px-3 text-base ${isActive ? "-mb-px border-b-2 border-accent font-semibold" : "text-muted hover:text-primary"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function TypeEditorSections({
  module,
  form,
  people,
  approval,
}: Readonly<{ module: FormModule; form: ReactNode; people?: ReactNode; approval?: ReactNode }>) {
  const t = useFormText();
  const { section } = useParams();
  if (section === "form") return form;
  if (module === "contract" && section === "people") return people;
  if (module === "contract" && section === "approval") return approval;
  return <p>{t("This section does not exist.")}</p>;
}
