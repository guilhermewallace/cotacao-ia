"use server";

import { z } from "zod";
import { updateOrganizationSettings } from "@/modules/identity/organizations";
import { addMember, removeMember, updateMemberRole } from "@/modules/identity/users";
import { idSchema } from "@/platform/ids";
import { runAction, type ActionResult } from "@/server/actions";

const roleSchema = z.enum(["OWNER", "ADMIN", "SELLER", "VIEWER"]);

export async function updateOrganizationAction(input: {
  name: string;
  legalName: string | null;
  taxId: string | null;
  defaultQuotationValidityDays: number;
  documentRetentionDays: number | null;
}): Promise<ActionResult> {
  return runAction("settings.updateOrganization", async (ctx) => {
    await updateOrganizationSettings(ctx, input);
    return undefined;
  });
}

export async function addMemberAction(input: { name: string; email: string; role: string }): Promise<ActionResult> {
  return runAction("settings.addMember", async (ctx) => {
    await addMember(ctx, { name: input.name, email: input.email, role: roleSchema.parse(input.role) });
    return undefined;
  });
}

export async function updateMemberRoleAction(membershipId: string, role: string): Promise<ActionResult> {
  return runAction("settings.updateMemberRole", async (ctx) => {
    await updateMemberRole(ctx, idSchema.parse(membershipId), roleSchema.parse(role));
    return undefined;
  });
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult> {
  return runAction("settings.removeMember", async (ctx) => {
    await removeMember(ctx, idSchema.parse(membershipId));
    return undefined;
  });
}
