import type { Metadata } from "next";
import { PageContainer, PageHeader, LinkTabs } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { oneOf, readSearchParams, type SearchPageProps } from "@/lib/params";
import { listAuditLogs } from "@/modules/audit/audit";
import { getOrganization } from "@/modules/identity/organizations";
import { can, canManageRole, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/modules/identity/permissions";
import { listMembers } from "@/modules/identity/users";
import { formatDateTime, formatRelative } from "@/platform/dates";
import { requirePage } from "@/server/session";
import { AddMemberForm, MemberRowControls, OrganizationForm } from "./settings-forms";

export const metadata: Metadata = { title: "Configurações" };

const TABS = ["empresa", "membros", "auditoria"] as const;
const ROLES = ["OWNER", "ADMIN", "SELLER", "VIEWER"] as const;

const AUDIT_LABELS: Record<string, string> = {
  "attachment.download": "Baixou um anexo",
  "catalog.import": "Importou produtos",
  "customer.create": "Cadastrou cliente",
  "customer.update": "Alterou cliente",
  "inbound.received": "Solicitação recebida",
  "integration.credentials_update": "Atualizou credenciais de integração",
  "integration.disconnect": "Desconectou integração",
  "integration.email_address_rotate": "Gerou novo endereço de e-mail de entrada",
  "integration.update": "Alterou integração",
  "member.add": "Adicionou membro",
  "member.remove": "Removeu membro",
  "member.role_change": "Alterou papel de membro",
  "organization.create": "Empresa criada",
  "organization.update": "Alterou configurações da empresa",
  "price_list.create": "Criou lista de preços",
  "price_list.import": "Importou lista de preços",
  "price_list.item_set": "Alterou preço em lista",
  "price_list.set_default": "Definiu lista de preços padrão",
  "product.alias_add": "Adicionou sinônimo/código",
  "product.alias_remove": "Removeu sinônimo/código",
  "product.create": "Criou produto",
  "product.update": "Alterou produto",
  "quotation.cancel": "Cancelou cotação",
  "quotation.create": "Gerou cotação",
  "quotation.export": "Exportou cotação",
  "quotation.finalize": "Finalizou cotação",
  "quotation.reopen": "Reabriu cotação",
  "quotation.reprice": "Atualizou preços da cotação",
  "quotation.update": "Editou cotação",
  "request.accept_suggested": "Aceitou sugestões fortes",
  "request.customer_set": "Definiu cliente da solicitação",
  "request.discard": "Descartou solicitação",
  "request.documents_delete": "Excluiu documentos originais",
  "request.item_add": "Adicionou item manualmente",
  "request.item_confirm": "Confirmou produto de um item",
  "request.item_not_found": "Marcou item como não encontrado",
  "request.item_price": "Alterou preço de um item",
  "request.item_quantity": "Alterou quantidade de um item",
  "request.item_remove": "Removeu item",
  "request.item_reopen": "Reabriu item",
  "request.processed": "Solicitação processada",
  "request.reprocess": "Reprocessou solicitação",
  "request.restore": "Restaurou solicitação",
  "retention.purge": "Exclusão automática por retenção",
};

const ACTOR_LABELS: Record<string, string> = { SYSTEM: "Sistema", WEBHOOK: "Canal de entrada" };

/** Resumo curto e seguro dos metadados (somente valores simples). */
function summarizeMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 60)}`)
    .join(" · ");
}

export default async function SettingsPage({ searchParams }: SearchPageProps) {
  const { ctx } = await requirePage("settings:manage");
  const params = await readSearchParams(searchParams);
  const canMembers = can(ctx, "members:manage");
  const canAudit = can(ctx, "audit:read");
  const requested = oneOf(params.aba, TABS, "empresa");
  const tab = (requested === "membros" && !canMembers) || (requested === "auditoria" && !canAudit) ? "empresa" : requested;

  return (
    <PageContainer>
      <PageHeader title="Configurações" description="Dados da empresa, pessoas com acesso e registro de auditoria." />
      <LinkTabs
        label="Seções de configuração"
        className="mb-4"
        items={[
          { href: "/configuracoes", label: "Empresa", active: tab === "empresa" },
          ...(canMembers ? [{ href: "/configuracoes?aba=membros", label: "Membros", active: tab === "membros" }] : []),
          ...(canAudit ? [{ href: "/configuracoes?aba=auditoria", label: "Auditoria", active: tab === "auditoria" }] : []),
        ]}
      />
      {tab === "empresa" ? <CompanyTab ctx={ctx} /> : tab === "membros" ? <MembersTab ctx={ctx} /> : <AuditTab ctx={ctx} />}
    </PageContainer>
  );
}

type Ctx = Awaited<ReturnType<typeof requirePage>>["ctx"];

async function CompanyTab({ ctx }: { ctx: Ctx }) {
  const organization = await getOrganization(ctx);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Empresa</CardTitle>
          <CardDescription>
            Identificador: <code className="font-mono text-xs">{organization.slug}</code>
            {organization.isDemo ? " · organização de demonstração (dados fictícios)" : ""}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <OrganizationForm
          key={JSON.stringify(organization)}
          initial={{
            name: organization.name,
            legalName: organization.legalName ?? "",
            taxId: organization.taxId ?? "",
            defaultQuotationValidityDays: String(organization.defaultQuotationValidityDays),
            documentRetentionDays: organization.documentRetentionDays === null ? "" : String(organization.documentRetentionDays),
          }}
        />
      </CardContent>
    </Card>
  );
}

async function MembersTab({ ctx }: { ctx: Ctx }) {
  const members = await listMembers(ctx);
  // Só oferece os papéis que o usuário atual pode atribuir (a regra é reaplicada no servidor).
  const assignable = ROLES.filter((role) => canManageRole(ctx.role, null, role)).map((role) => ({ value: role, label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] }));

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Membros</CardTitle>
            <CardDescription>Pessoas com acesso aos dados desta empresa. Cada pessoa só enxerga as empresas das quais é membro.</CardDescription>
          </div>
        </CardHeader>
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Pessoa</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.membershipId}>
                  <TableCell>
                    <span className="font-medium">{member.name}</span>
                    <span className="block text-xs text-muted-foreground">{member.email}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{ROLE_LABELS[member.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{member.lastLoginAt ? formatRelative(member.lastLoginAt) : "nunca acessou"}</TableCell>
                  <TableCell>
                    {member.isSelf || canManageRole(ctx.role, member.role, member.role) ? (
                      <MemberRowControls membershipId={member.membershipId} name={member.name} role={member.role} roles={assignable} isSelf={member.isSelf} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Adicionar membro</CardTitle>
            <CardDescription>A pessoa entra com este e-mail. Se ainda não tiver conta, o acesso é vinculado no primeiro login com e-mail verificado.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <AddMemberForm roles={assignable} />
          <dl className="grid gap-2 border-t pt-4 sm:grid-cols-2">
            {ROLES.map((role) => (
              <div key={role}>
                <dt className="text-[13px] font-medium">{ROLE_LABELS[role]}</dt>
                <dd className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

async function AuditTab({ ctx }: { ctx: Ctx }) {
  const logs = await listAuditLogs(ctx, { limit: 150 });
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div>
          <CardTitle>Auditoria</CardTitle>
          <CardDescription>Últimas {logs.length} ações registradas nesta empresa. Os registros não podem ser editados nem excluídos pela aplicação.</CardDescription>
        </div>
      </CardHeader>
      <div className="border-t">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Quando</TableHead>
              <TableHead>Quem</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(log.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{log.actorName ?? ACTOR_LABELS[log.actorType] ?? "—"}</TableCell>
                <TableCell>{AUDIT_LABELS[log.action] ?? log.action}</TableCell>
                <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={summarizeMetadata(log.metadata)}>
                  {summarizeMetadata(log.metadata) || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {logs.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Nenhuma ação registrada ainda.</p> : null}
      </div>
    </Card>
  );
}
