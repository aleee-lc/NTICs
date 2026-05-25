import { env } from "../config/env";

interface OrganizationMemberEmailInput {
  to: string;
  organizationName: string;
  role: "owner" | "admin" | "member" | "viewer";
}

const roleLabels: Record<OrganizationMemberEmailInput["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export async function sendOrganizationMemberEmail(
  input: OrganizationMemberEmailInput,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    return false;
  }

  const subject = `Te agregaron a ${input.organizationName} en PaperHub`;
  const escapedOrg = escapeHtml(input.organizationName);
  const role = roleLabels[input.role];

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [input.to],
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;color:#10203a;line-height:1.5">
          <h1 style="margin:0 0 12px">Te agregaron a PaperHub</h1>
          <p>Ya tienes acceso a la organizacion <strong>${escapedOrg}</strong>.</p>
          <p>Rol asignado: <strong>${role}</strong>.</p>
          <p>
            <a href="${env.APP_URL}" style="display:inline-block;background:#11305c;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:700">
              Abrir PaperHub
            </a>
          </p>
        </div>
      `,
      text: `Te agregaron a ${input.organizationName} en PaperHub con rol ${role}. Abre PaperHub: ${env.APP_URL}`,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Resend respondio ${response.status}: ${details}`);
  }

  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
