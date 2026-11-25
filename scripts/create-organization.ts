/**
 * Cria uma organização (empresa) real, com o primeiro usuário como proprietário.
 * O usuário entra com o mesmo e-mail pelo provedor de autenticação configurado
 * (com Supabase Auth, o vínculo é feito no primeiro login com e-mail verificado).
 *
 * Uso:
 *   npm run org:create -- --nome "Distribuidora Exemplo" --email dono@exemplo.com.br --usuario "Nome do Dono"
 *   Opcional: --razao-social "Distribuidora Exemplo Ltda."
 */
import "./lib/load-env";
import { createOrganization } from "../src/modules/identity/organizations";
import { inboundAddress } from "../src/modules/integrations/integrations";
import { disconnectPrisma, getPrisma } from "../src/platform/db";
import { readArgs, stringArg } from "./lib/args";

async function main(): Promise<void> {
  const args = readArgs();
  const name = stringArg(args, "nome");
  const ownerEmail = stringArg(args, "email");
  const ownerName = stringArg(args, "usuario");
  if (!name || !ownerEmail || !ownerName) {
    throw new Error('Uso: npm run org:create -- --nome "Empresa" --email dono@empresa.com.br --usuario "Nome do Dono" [--razao-social "..."]');
  }

  const created = await createOrganization({ name, ownerEmail, ownerName, legalName: stringArg(args, "razao-social") ?? null });
  const organization = await getPrisma().organization.findUniqueOrThrow({ where: { id: created.organizationId }, select: { slug: true, inboundEmailKey: true } });
  console.log("Organização criada:");
  console.log(`  Nome          : ${name}`);
  console.log(`  Identificador : ${organization.slug}`);
  console.log(`  Proprietário  : ${ownerName} <${ownerEmail.toLowerCase()}>`);
  console.log(`  E-mail entrada: ${inboundAddress(organization.inboundEmailKey)} (ative em Integrações)`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
