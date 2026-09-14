// SPDX-License-Identifier: AGPL-3.0-only

/** Audience choices and the statement Business Users acknowledge before generating. */
import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import type { AutoDocAnswer, AutoDocOptions } from "../../lib/auto-docs";

export type PortalSettingsDraft = {
  audienceUserIds: string[];
  audienceDepartmentIds: string[];
  acknowledgementFrequency: AutoDocAnswer["autoDoc"]["acknowledgementFrequency"];
  acknowledgementText: string | null;
};
export function PortalSettingsFields({
  record,
  options,
  audience,
  value,
  onChange,
}: {
  record: AutoDocAnswer;
  options: AutoDocOptions;
  audience: AutoDocAnswer["autoDoc"]["audience"];
  value: PortalSettingsDraft;
  onChange: (value: PortalSettingsDraft) => void;
}) {
  const intl = useIntl();
  return (
    <>
      {audience === "selected" && (
        <>
          <label className="block space-y-1">
            <span>
              <FormattedMessage id="autoDocs.audiencePeople" defaultMessage="Selected people" />
            </span>
            <select
              multiple
              className={`${CONTROL_CLASS} h-auto min-h-24`}
              value={value.audienceUserIds}
              onChange={(event) =>
                onChange({
                  ...value,
                  audienceUserIds: [...event.target.selectedOptions].map((option) => option.value),
                })
              }
            >
              {value.audienceUserIds
                .filter((id) => !options.audienceUsers.some((person) => person.id === id))
                .map((id) => (
                  <option key={id} value={id}>
                    {intl.formatMessage({
                      id: "autoDocs.unavailablePerson",
                      defaultMessage: "Unavailable person",
                    })}
                  </option>
                ))}
              {options.audienceUsers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span>
              <FormattedMessage
                id="autoDocs.audienceDepartments"
                defaultMessage="Selected Departments"
              />
            </span>
            <select
              multiple
              className={`${CONTROL_CLASS} h-auto min-h-24`}
              value={value.audienceDepartmentIds}
              onChange={(event) =>
                onChange({
                  ...value,
                  audienceDepartmentIds: [...event.target.selectedOptions].map(
                    (option) => option.value,
                  ),
                })
              }
            >
              {value.audienceDepartmentIds
                .filter((id) => !options.departments.some((department) => department.id === id))
                .map((id) => (
                  <option key={id} value={id}>
                    {intl.formatMessage({
                      id: "autoDocs.unavailableDepartment",
                      defaultMessage: "Archived Department",
                    })}
                  </option>
                ))}
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.displayName}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted @lg/page:col-span-2">
            <FormattedMessage
              id="autoDocs.selectedAudienceHelp"
              defaultMessage="A person can use this Auto-Doc when selected directly or through their live Department. Legal can always use it in the app."
            />
          </p>
        </>
      )}
      <label className="block space-y-1">
        <span>
          <FormattedMessage
            id="autoDocs.acknowledgementFrequency"
            defaultMessage="Acknowledgement frequency"
          />
        </span>
        <select
          className={CONTROL_CLASS}
          value={value.acknowledgementFrequency}
          onChange={(event) => {
            const next = event.target.value;
            if (
              next === "none" ||
              next === "every_use" ||
              next === "once_per_auto_doc" ||
              next === "once"
            )
              onChange({ ...value, acknowledgementFrequency: next });
          }}
        >
          {(["none", "every_use", "once_per_auto_doc", "once"] as const).map((frequency) => (
            <option key={frequency} value={frequency}>
              {intl.formatMessage(
                {
                  id: "autoDocs.acknowledgementFrequencyName",
                  defaultMessage:
                    "{frequency, select, none {None} every_use {Every use} once_per_auto_doc {Once per Auto-Doc} other {Once across Auto-Docs}}",
                },
                { frequency },
              )}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-3 @lg/page:col-span-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.acknowledgementText === null}
            onChange={(event) =>
              onChange({
                ...value,
                acknowledgementText: event.target.checked
                  ? null
                  : record.defaultAcknowledgementText,
              })
            }
          />
          <span>
            <FormattedMessage
              id="autoDocs.defaultAcknowledgement"
              defaultMessage="Use the organisation's acknowledgement text"
            />
          </span>
        </label>
        {value.acknowledgementText === null ? (
          <p className="whitespace-pre-wrap text-sm text-muted">
            {record.defaultAcknowledgementText}
          </p>
        ) : (
          <label className="block space-y-1">
            <span>
              <FormattedMessage
                id="autoDocs.acknowledgementText"
                defaultMessage="Acknowledgement text"
              />
            </span>
            <textarea
              required
              maxLength={10_000}
              className={TEXTAREA_CLASS}
              value={value.acknowledgementText}
              onChange={(event) => onChange({ ...value, acknowledgementText: event.target.value })}
            />
          </label>
        )}
        <p className="text-sm text-muted">
          <FormattedMessage
            id="autoDocs.acknowledgementHelp"
            defaultMessage="Business Users acknowledge this statement before generating. Editing the text requires them to acknowledge it again. Administrators and Legal Team Members never acknowledge."
          />
        </p>
      </div>
    </>
  );
}
