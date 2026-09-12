// SPDX-License-Identifier: AGPL-3.0-only

import { redirect, type LoaderFunctionArgs } from "react-router";
import { useIntl } from "react-intl";
import {
  PORTAL_CONTRACT_FILTER_KEYS,
  PORTAL_CONTRACT_SORT_KEYS,
  CONTRACT_STAGES,
} from "@openlaw/shared";
import { api } from "../lib/api";
import { currentUser } from "../lib/session";
import type { Layout } from "../lib/list-views";
import { portalListLayout, portalListQuery } from "../lib/portal-lists";
import { stageLabel } from "../lib/contracts";
import { PORTAL_CONTRACTS_CATALOGUE as catalogue } from "../components/portal/record-list-columns";
import { PortalRecordList } from "../components/portal/record-list";

async function read(layout: Layout, cursor?: number) {
  const query = portalListQuery(layout, PORTAL_CONTRACT_FILTER_KEYS);
  const { data } = await api.GET("/api/v1/portal/contracts", {
    params: {
      query: {
        ...query,
        ...(cursor ? { cursor } : {}),
        sort: PORTAL_CONTRACT_SORT_KEYS.find((key) => key === layout.sort?.key),
        dir: layout.sort?.dir,
      },
    },
  });
  return data
    ? {
        rows: data.contracts,
        total: data.total,
        nextCursor: data.nextCursor,
        filterOptions: data.filterOptions,
      }
    : undefined;
}
export async function portalContractsLoader(args: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const layout = portalListLayout(
    catalogue,
    args,
    PORTAL_CONTRACT_FILTER_KEYS,
    PORTAL_CONTRACT_SORT_KEYS,
  );
  const cursor = Number(new URL(args.request.url).searchParams.get("cursor"));
  const data = await read(layout, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  if (!data) throw new Error("Your Contracts could not be read.");
  return { user, layout, ...data };
}
export function PortalContractsPage() {
  const intl = useIntl();
  return (
    <PortalRecordList
      catalogue={catalogue}
      filterKeys={PORTAL_CONTRACT_FILTER_KEYS}
      read={read}
      path="/portal/contracts"
      title={intl.formatMessage({ id: "portal.contracts.title", defaultMessage: "Your Contracts" })}
      description={intl.formatMessage({
        id: "portal.contracts.description",
        defaultMessage: "Contracts you are on the team for.",
      })}
      searchLabel={intl.formatMessage({
        id: "portal.contracts.search",
        defaultMessage: "Search Contracts",
      })}
      definitions={(options) => [
        {
          key: "typeId",
          label: intl.formatMessage({ id: "portal.list.column.type", defaultMessage: "Type" }),
          kind: "choices",
          multiple: false,
          choices: options.types,
        },
        {
          key: "ownerId",
          label: intl.formatMessage({
            id: "portal.list.column.legalOwner",
            defaultMessage: "Legal Owner",
          }),
          kind: "choices",
          multiple: false,
          choices: options.owners,
        },
        {
          key: "stage",
          label: intl.formatMessage({ id: "portal.list.column.stage", defaultMessage: "Stage" }),
          kind: "choices",
          multiple: false,
          choices: CONTRACT_STAGES.map((stage) => ({
            id: stage,
            displayName: stageLabel(intl, stage),
          })),
        },
        {
          key: "expiry",
          label: intl.formatMessage({
            id: "portal.list.column.expiryDate",
            defaultMessage: "Expiry date",
          }),
          kind: "date",
        },
      ]}
    />
  );
}
