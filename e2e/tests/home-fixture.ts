// SPDX-License-Identifier: AGPL-3.0-only

/** Public-API fixtures for a populated M29 Home. */
import { expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";

const Types = z.object({
  contractTypes: z.array(
    z.object({ id: z.string(), slug: z.string(), archivedAt: z.string().nullable() }),
  ),
});
const MatterTypes = z.object({
  matterTypes: z.array(
    z.object({ id: z.string(), slug: z.string(), archivedAt: z.string().nullable() }),
  ),
});
const EntityTypes = z.object({
  entityTypes: z.array(z.object({ id: z.string(), slug: z.string() })),
});
const CreatedContract = z.object({
  contract: z.object({ id: z.string(), number: z.number() }),
});
const CreatedMatter = z.object({ matter: z.object({ id: z.string(), number: z.number() }) });
const CreatedEntity = z.object({ entity: z.object({ id: z.string() }) });

function inDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function successful(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  status: number,
) {
  expect(response.status(), await response.text()).toBe(status);
  return response;
}

export interface PopulatedHomeFixture {
  contract: { id: string; number: number; title: string };
  matter: { id: string; number: number; title: string };
  entity: { id: string; legalName: string };
  approvalLabel: string;
  taskTitle: string;
  keyDateLabel: string;
  obligationLabel: string;
  cleanup: () => Promise<void>;
}

/**
 * Gives one live Member+ user each row the M29 demo sentence names.
 * The caller stays signed in as an Administrator and performs setup
 * through the same HTTP routes a person uses.
 */
export async function createPopulatedHomeFixture(
  request: APIRequestContext,
  userId: string,
  suffix: string,
): Promise<PopulatedHomeFixture> {
  let contractNumber: number | undefined;
  let matterNumber: number | undefined;
  let entityId: string | undefined;

  const cleanup = async () => {
    const failures: unknown[] = [];
    const settle = async (step: () => Promise<void>) => {
      await step().catch((error: unknown) => failures.push(error));
    };
    if (contractNumber !== undefined) {
      await settle(async () => {
        await successful(await request.post(`/api/v1/contracts/${contractNumber}/archive`), 200);
      });
    }
    if (matterNumber !== undefined) {
      await settle(async () => {
        await successful(await request.post(`/api/v1/matters/${matterNumber}/archive`), 200);
      });
    }
    if (entityId !== undefined) {
      await settle(async () => {
        await successful(await request.post(`/api/v1/entities/${entityId}/archive`), 200);
      });
    }
    if (failures.length > 0) throw new AggregateError(failures, "Home fixture cleanup failed");
  };

  try {
    const contractTypesResponse = await request.get("/api/v1/contract-types");
    expect(contractTypesResponse.status(), await contractTypesResponse.text()).toBe(200);
    const contractType = Types.parse(await contractTypesResponse.json()).contractTypes.find(
      (row) => row.slug === "other" && row.archivedAt === null,
    );
    expect(contractType, "the install has no live Other Contract Type").toBeDefined();

    const matterTypesResponse = await request.get("/api/v1/matter-types");
    expect(matterTypesResponse.status(), await matterTypesResponse.text()).toBe(200);
    const matterType = MatterTypes.parse(await matterTypesResponse.json()).matterTypes.find(
      (row) => row.slug === "other" && row.archivedAt === null,
    );
    expect(matterType, "the install has no live Other Matter Type").toBeDefined();

    const entityTypesResponse = await request.get("/api/v1/entities/types");
    expect(entityTypesResponse.status(), await entityTypesResponse.text()).toBe(200);
    const entityType = EntityTypes.parse(await entityTypesResponse.json()).entityTypes.find(
      (row) => row.slug === "corporation",
    );
    expect(entityType, "the install has no live Corporation Entity Type").toBeDefined();

    const contractTitle = `M29 managed Contract ${suffix}`;
    const contractResponse = await successful(
      await request.post("/api/v1/contracts", {
        data: { title: contractTitle, contractTypeId: contractType!.id },
      }),
      201,
    );
    const contract = CreatedContract.parse(await contractResponse.json()).contract;
    contractNumber = contract.number;
    await successful(
      await request.patch(`/api/v1/contracts/${contract.number}`, { data: { managerId: userId } }),
      200,
    );
    await successful(
      await request.post(`/api/v1/contracts/${contract.number}/approvals`, {
        data: { approverIds: [userId] },
      }),
      201,
    );
    const keyDateLabel = `M29 signing deadline ${suffix}`;
    await successful(
      await request.post(`/api/v1/contracts/${contract.number}/key-dates`, {
        data: { date: inDays(14), label: keyDateLabel },
      }),
      201,
    );

    const matterTitle = `M29 managed Matter ${suffix}`;
    const matterResponse = await successful(
      await request.post("/api/v1/matters", {
        data: { title: matterTitle, matterTypeId: matterType!.id },
      }),
      201,
    );
    const matter = CreatedMatter.parse(await matterResponse.json()).matter;
    matterNumber = matter.number;
    await successful(
      await request.patch(`/api/v1/matters/${matter.number}`, { data: { managerId: userId } }),
      200,
    );
    const taskTitle = `M29 assigned Task ${suffix}`;
    await successful(
      await request.post(`/api/v1/matters/${matter.number}/tasks`, {
        data: { title: taskTitle, assigneeId: userId, dueDate: inDays(7) },
      }),
      201,
    );

    const legalName = `M29 Entity ${suffix}`;
    const entityResponse = await successful(
      await request.post("/api/v1/entities", {
        data: {
          legalName,
          entityTypeId: entityType!.id,
          jurisdiction: "Delaware",
          status: "active",
        },
      }),
      201,
    );
    const entity = CreatedEntity.parse(await entityResponse.json()).entity;
    entityId = entity.id;
    const obligationLabel = `M29 annual return ${suffix}`;
    await successful(
      await request.post(`/api/v1/entities/${entity.id}/obligations`, {
        data: { label: obligationLabel, nextDueOn: inDays(21), assigneeId: userId },
      }),
      201,
    );

    return {
      contract: { ...contract, title: contractTitle },
      matter: { ...matter, title: matterTitle },
      entity: { ...entity, legalName },
      approvalLabel: contractTitle,
      taskTitle,
      keyDateLabel,
      obligationLabel,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
