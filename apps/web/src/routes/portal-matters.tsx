// SPDX-License-Identifier: AGPL-3.0-only

import { redirect, type LoaderFunctionArgs } from "react-router";
import { useIntl } from "react-intl";
import { PORTAL_MATTER_FILTER_KEYS, PORTAL_MATTER_SORT_KEYS } from "@openlaw/shared";
import { api } from "../lib/api";
import { currentUser } from "../lib/session";
import type { Layout } from "../lib/list-views";
import { portalListLayout, portalListQuery } from "../lib/portal-lists";

import { PORTAL_MATTERS_CATALOGUE as catalogue } from "../components/portal/record-list-columns";
import { PortalRecordList } from "../components/portal/record-list";

async function read(layout: Layout, cursor?: number) {
  const query = portalListQuery(layout, PORTAL_MATTER_FILTER_KEYS);
  const { data } = await api.GET("/api/v1/portal/matters", {
    params: {
      query: {
        ...query,
        ...(cursor ? { cursor } : {}),
        sort: PORTAL_MATTER_SORT_KEYS.find((key) => key === layout.sort?.key),
        dir: layout.sort?.dir,
      },
    },
  });
  return data
    ? {
        rows: data.matters,
        total: data.total,
        nextCursor: data.nextCursor,
        filterOptions: data.filterOptions,
      }
    : undefined;
}
export async function portalMattersLoader(args: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  const layout = portalListLayout(
    catalogue,
    args,
    PORTAL_MATTER_FILTER_KEYS,
    PORTAL_MATTER_SORT_KEYS,
  );
  const cursor = Number(new URL(args.request.url).searchParams.get("cursor"));
  const data = await read(layout, Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined);
  if (!data) throw new Error("Your Matters could not be read.");
  return { user, layout, ...data };
}
export function PortalMattersPage() {
  const intl = useIntl();
  return (
    <PortalRecordList
      catalogue={catalogue}
      filterKeys={PORTAL_MATTER_FILTER_KEYS}
      read={read}
      path="/portal/matters"
      title={intl.formatMessage({ id: "portal.matters.title", defaultMessage: "Your Matters" })}
      description={intl.formatMessage({
        id: "portal.matters.description",
        defaultMessage: "Matters you are on the team for.",
      })}
      searchLabel={intl.formatMessage({
        id: "portal.matters.search",
        defaultMessage: "Search Matters",
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
            id: "portal.list.column.manager",
            defaultMessage: "Matter Manager",
          }),
          kind: "choices",
          multiple: false,
          choices: options.owners,
        },
        {
          key: "statusId",
          label: intl.formatMessage({ id: "portal.list.column.status", defaultMessage: "Status" }),
          kind: "choices",
          multiple: false,
          choices: options.statuses ?? [],
        },
        {
          key: "category",
          label: intl.formatMessage({
            id: "portal.matters.filter.lifecycle",
            defaultMessage: "Lifecycle",
          }),
          kind: "choices",
          multiple: false,
          choices: [
            {
              id: "open",
              displayName: intl.formatMessage({
                id: "portal.matters.filter.open",
                defaultMessage: "Open",
              }),
            },
            {
              id: "closed",
              displayName: intl.formatMessage({
                id: "portal.matters.filter.closed",
                defaultMessage: "Closed",
              }),
            },
          ],
        },
      ]}
    />
  );
}
