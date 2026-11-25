"use server";

import { z } from "zod";
import { simulateInboundEmail, simulateWhatsAppMessage } from "@/demo/simulate";
import { disconnectWhatsAppIntegration, rotateInboundEmailKey, saveWhatsAppIntegration, setEmailIntegrationEnabled } from "@/modules/integrations/integrations";
import { runAction, type ActionResult } from "@/server/actions";

/** Server Actions de Integrações (exigem a permissão integrations:manage, conferida nos serviços). */

export async function saveWhatsAppIntegrationAction(input: {
  phoneNumberId: string;
  displayPhoneNumber?: string;
  businessAccountId?: string;
  accessToken?: string;
}): Promise<ActionResult> {
  return runAction("integration.saveWhatsApp", async (ctx) => {
    // O token chega por HTTPS dentro da Server Action, é cifrado (AES-256-GCM) antes de
    // ser gravado e nunca é devolvido ao navegador — apenas uma máscara dos últimos caracteres.
    await saveWhatsAppIntegration(ctx, input);
    return undefined;
  });
}

export async function disconnectWhatsAppIntegrationAction(): Promise<ActionResult> {
  return runAction("integration.disconnectWhatsApp", async (ctx) => {
    await disconnectWhatsAppIntegration(ctx);
    return undefined;
  });
}

export async function setEmailIntegrationEnabledAction(enabled: boolean): Promise<ActionResult> {
  return runAction("integration.setEmailEnabled", async (ctx) => {
    await setEmailIntegrationEnabled(ctx, z.boolean().parse(enabled));
    return undefined;
  });
}

export async function rotateInboundEmailKeyAction(): Promise<ActionResult<{ address: string }>> {
  return runAction("integration.rotateEmailKey", async (ctx) => ({ address: await rotateInboundEmailKey(ctx) }));
}

export async function simulateWhatsAppAction(): Promise<ActionResult<{ sample: string }>> {
  return runAction("integration.simulateWhatsApp", (ctx) => simulateWhatsAppMessage(ctx));
}

export async function simulateEmailAction(): Promise<ActionResult<{ sample: string }>> {
  return runAction("integration.simulateEmail", (ctx) => simulateInboundEmail(ctx));
}
