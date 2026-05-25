import { env } from "../config/env";
import nodemailer from "nodemailer";

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
  if (!isSmtpConfigured() && !env.RESEND_API_KEY) {
    return false;
  }

  const subject = `Te agregaron a ${input.organizationName} en PaperHub`;
  const role = roleLabels[input.role];
  const html = buildOrganizationMemberHtml(input.organizationName, role);
  const text = `Te agregaron a ${input.organizationName} en PaperHub con rol ${role}. Abre PaperHub: ${env.APP_URL}`;

  if (isSmtpConfigured()) {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      connectionTimeout: env.SMTP_TIMEOUT_MS,
      greetingTimeout: env.SMTP_TIMEOUT_MS,
      socketTimeout: env.SMTP_TIMEOUT_MS,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: env.MAIL_FROM,
      to: input.to,
      subject,
      html,
      text,
    });

    return true;
  }

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
      html,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Resend respondio ${response.status}: ${details}`);
  }

  return true;
}

function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function buildOrganizationMemberHtml(organizationName: string, role: string): string {
  const escapedOrg = escapeHtml(organizationName);

  return `
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
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
