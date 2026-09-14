// SPDX-License-Identifier: AGPL-3.0-only

import { TaskAssigneePicker, type TaskAssigneePerson } from "./tasks/assignee-picker";
import { StatusNote, type FieldStatus } from "./status-note";
import { Label } from "./ui/label";

export function RecordPersonField({
  id,
  label,
  frozen,
  value,
  people,
  status,
  error,
  onChange,
}: {
  id: string;
  label: string;
  frozen: boolean;
  value: TaskAssigneePerson | null;
  people: readonly TaskAssigneePerson[];
  status: FieldStatus;
  error?: string;
  onChange: (id: string | null) => Promise<string | undefined>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div>
        <TaskAssigneePicker
          id={id}
          label={label}
          dialogLabel={label}
          taskTitle={label}
          value={value}
          people={people}
          readOnly={frozen}
          disabled={status === "saving"}
          onChange={async (personId) => (await onChange(personId)) ?? null}
        />
        {!frozen && <StatusNote status={status} detail={error} />}
      </div>
    </div>
  );
}
