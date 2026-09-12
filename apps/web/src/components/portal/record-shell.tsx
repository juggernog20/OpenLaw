// SPDX-License-Identifier: AGPL-3.0-only

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import { Plus, User } from "lucide-react";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../../lib/api";
import type { PortalDocument, PortalDocumentVersion, PortalWork } from "../../lib/portal-records";
import { portalContractReader } from "../../lib/portal-contracts";
import { DocPanel } from "../documents/doc-panel";
import { useActivityApplet } from "../activity/activity-applet";
import type { Applet } from "../shell/applets";
import { AddTeamDialog } from "../record-team-applet";
import { TeamRoster, type TeamRosterEntry } from "../team-roster";
import { Button } from "../ui/button";
import { PortalShell } from "./portal-shell";
import { useCommentApplet } from "../comments/comment-applet";

const DocumentPanelContext = createContext<
  ((document: PortalDocument, version: PortalDocumentVersion, trigger: HTMLElement) => void) | null
>(null);
export function usePortalDocumentPanel() {
  const open = useContext(DocumentPanelContext);
  if (!open) throw new Error("Portal documents require a record shell.");
  return open;
}

/** Mount keyed by record id so drafts and pages cannot cross a record navigation. */
export function PortalRecordShell({
  entityType,
  entityId,
  number,
  viewerId,
  work,
  ...shell
}: Readonly<
  Omit<ComponentProps<typeof PortalShell>, "applets"> & {
    entityType: "contract" | "matter" | "request";
    entityId?: string;
    number: number;
    viewerId: string;
    work?: PortalWork;
  }
>) {
  const intl = useIntl();
  const [reading, setReading] = useState<{
    document: PortalDocument;
    version: PortalDocumentVersion;
  } | null>(null);
  const [covers, setCovers] = useState(true);
  const [adding, setAdding] = useState(false);
  const addControl = useRef<HTMLButtonElement>(null);
  const [canAdd, setCanAdd] = useState(false);
  const readTrigger = useRef<HTMLElement | null>(null);
  const primaryReader = useMemo(() => portalContractReader(number), [number]);
  const openDocument = useCallback(
    (document: PortalDocument, version: PortalDocumentVersion, trigger: HTMLElement) => {
      readTrigger.current = trigger;
      setReading({ document, version });
    },
    [],
  );
  const conversation = useCommentApplet({
    enabled: !!entityId,
    surface: "portal",
    role: "business_user",
    entityType,
    entityId: entityId ?? "",
    viewerId,
  });
  const readPage = useCallback(
    async (cursor: string | null) => {
      if (!entityId) return undefined;
      const { data } = await api.GET("/api/v1/portal/activity", {
        params: { query: { entityType, entityId, ...(cursor ? { cursor } : {}) } },
      });
      return data;
    },
    [entityType, entityId],
  );
  const history = useActivityApplet({
    replaceOnRefresh: true,
    entityType,
    entityId: entityId ?? "",
    readPage,
    fields: work?.fields,
    referenceNames: Object.fromEntries(
      [...(work?.references.people ?? []), ...(work?.references.entities ?? [])].map(
        (reference) => [reference.id, reference.label],
      ),
    ),
    emptyMessage: defineMessage({
      id: "portal.history.empty",
      defaultMessage: "No shared history yet.",
    }),
  });
  const team: Applet | null =
    entityType === "request"
      ? null
      : {
          id: "team",
          icon: User,
          label:
            entityType === "contract"
              ? defineMessage({ id: "contracts.applet.team", defaultMessage: "Contract team" })
              : defineMessage({ id: "matters.applet.team", defaultMessage: "Matter team" }),
          accessory: () => (
            <Button
              ref={addControl}
              variant="ghost"
              size="icon"
              disabled={!canAdd}
              aria-label={intl.formatMessage({
                id: "record.team.add",
                defaultMessage: "Add team member",
              })}
              onClick={() => setAdding(true)}
            >
              <Plus size={16} aria-hidden="true" />
            </Button>
          ),
          render: () => (
            <PortalTeam
              module={entityType}
              number={number}
              addControl={addControl}
              adding={adding}
              onAdding={setAdding}
              onCanAdd={setCanAdd}
            />
          ),
        };
  return (
    <DocumentPanelContext value={openDocument}>
      <PortalShell
        {...shell}
        contentCovered={reading !== null && covers}
        layer={
          reading ? (
            <DocPanel
              documentId={reading.document.id}
              title={reading.document.title}
              version={reading.version}
              source={
                entityType === "contract" && reading.document.isPrimary ? primaryReader : undefined
              }
              onDockedChange={(docked) => setCovers(!docked)}
              onClose={() => {
                setReading(null);
                setTimeout(() => {
                  if (readTrigger.current?.isConnected) readTrigger.current.focus();
                }, 0);
              }}
            />
          ) : undefined
        }
        applets={entityId ? [...(team ? [team] : []), conversation, history] : undefined}
      />
    </DocumentPanelContext>
  );
}

type Team =
  paths["/api/v1/portal/contracts/{number}/team"]["get"]["responses"]["200"]["content"]["application/json"];

function PortalTeam({
  addControl,
  module,
  number,
  adding,
  onAdding,
  onCanAdd,
}: Readonly<{
  addControl: RefObject<HTMLButtonElement | null>;
  module: "contract" | "matter";
  number: number;
  adding: boolean;
  onAdding: (open: boolean) => void;
  onCanAdd: (canAdd: boolean) => void;
}>) {
  const intl = useIntl();
  const [team, setTeam] = useState<Team | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void api
      .GET(`/api/v1/portal/${module}s/{number}/team`, { params: { path: { number } } })
      .catch(() => ({ data: undefined }))
      .then(({ data }) => {
        if (!current) return;
        setTeam(data ?? null);
        setFailed(!data);
        onCanAdd(Boolean(data?.canAdd));
      });
    return () => {
      current = false;
      onCanAdd(false);
      onAdding(false);
    };
  }, [module, number, attempt, onCanAdd, onAdding]);
  if (!team)
    return failed ? (
      <div className="flex flex-col items-start gap-3 p-4">
        <p role="alert" className="text-sm text-status-danger-fg">
          <FormattedMessage id="portal.team.failed" defaultMessage="The team could not be read." />
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          <FormattedMessage id="common.retry" defaultMessage="Try again" />
        </Button>
      </div>
    ) : null;
  const entries: TeamRosterEntry[] = [];
  if (team.manager)
    entries.push({
      person: team.manager,
      statement: intl.formatMessage(
        module === "contract"
          ? { id: "contracts.form.legalOwner", defaultMessage: "Legal Owner" }
          : { id: "portal.matter.manager", defaultMessage: "Matter Manager" },
      ),
    });
  if (team.businessOwner)
    entries.push({
      person: team.businessOwner,
      statement: intl.formatMessage({
        id: "contracts.form.businessOwner",
        defaultMessage: "Business Owner",
      }),
    });
  if (team.creator)
    entries.push({
      person: team.creator,
      statement: intl.formatMessage({
        id: "record.team.creator",
        defaultMessage: "Creator",
      }),
    });
  entries.push(...team.team.map((person) => ({ person })));
  return (
    <>
      <TeamRoster entries={entries} />
      {!team.canAdd && (
        <p className="px-4 py-3 text-sm text-muted">
          <FormattedMessage
            id="portal.team.confidential"
            defaultMessage="Ask Legal to add members to a Confidential record."
          />
        </p>
      )}
      {adding && team.canAdd && (
        <AddTeamDialog
          returnFocusRef={addControl}
          surface="portal"
          module={module}
          number={number}
          users={team.people.filter(
            (person) => !team.team.some((member) => member.id === person.id),
          )}
          disabled={false}
          onOpenChange={onAdding}
          onAdded={(members) =>
            setTeam((current) => (current ? { ...current, team: members } : null))
          }
        />
      )}
    </>
  );
}
