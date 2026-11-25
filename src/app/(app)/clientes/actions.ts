"use server";

import { createCustomer, updateCustomer, type CustomerInput } from "@/modules/customers/customers";
import { idSchema } from "@/platform/ids";
import { runAction, type ActionResult } from "@/server/actions";

export async function createCustomerAction(input: CustomerInput): Promise<ActionResult<{ id: string }>> {
  return runAction("customer.create", (ctx) => createCustomer(ctx, input));
}

export async function updateCustomerAction(customerId: string, input: CustomerInput): Promise<ActionResult> {
  return runAction("customer.update", async (ctx) => {
    await updateCustomer(ctx, idSchema.parse(customerId), input);
    return undefined;
  });
}
