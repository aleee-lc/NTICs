import { env } from "../config/env";
import { lookup } from "node:dns/promises";
import fetch from "node-fetch";
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";

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
    try {
      await sendWithSmtp({ to: input.to, subject, html, text });
      return true;
    } catch (smtpError) {
      if (!env.RESEND_API_KEY) {
        throw smtpError;
      }

      console.warn("SMTP no disponible, intentando Resend:", smtpError);
    }
  }

  await sendWithResend({ to: input.to, subject, html, text });
  return true;
}

async function sendWithSmtp(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const smtpHost = env.SMTP_HOST as string;
  const smtpAddress = await resolveIpv4Address(smtpHost);
  const smtpOptions: SMTPTransport.Options = {
    host: smtpAddress,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    connectionTimeout: env.SMTP_TIMEOUT_MS,
    greetingTimeout: env.SMTP_TIMEOUT_MS,
    socketTimeout: env.SMTP_TIMEOUT_MS,
    tls: {
      servername: smtpHost,
    },
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  };
  const transporter = nodemailer.createTransport(smtpOptions);

  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

async function sendWithResend(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Resend respondio ${response.status}: ${details}`);
  }
}

function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

async function resolveIpv4Address(host: string): Promise<string> {
  const result = await lookup(host, { family: 4 });
  return result.address;
}

function buildOrganizationMemberHtml(organizationName: string, role: string): string {
  const escapedOrg = escapeHtml(organizationName);

  return `
    <div style="margin:0;padding:0;background:#edf3fb;font-family:Arial,Helvetica,sans-serif;color:#10203a">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf3fb;padding:28px 14px">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d7e0ed;border-radius:18px;overflow:hidden;box-shadow:0 18px 42px rgba(13,34,63,0.14)">
              <tr>
                <td style="background:#11305c;padding:26px 28px;color:#ffffff">
                  <div style="font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#b8d4f6">PaperHub</div>
                  <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;color:#ffffff">Ya tienes acceso</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:28px">
                  <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#40526d">
                    Te agregaron a la organizacion <strong style="color:#10203a">${escapedOrg}</strong> en PaperHub.
                  </p>
                  <div style="margin:22px 0;padding:16px;border:1px solid #d7e0ed;border-radius:12px;background:#f7fafe">
                    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5b6d87">Rol asignado</div>
                    <div style="margin-top:6px;font-size:22px;font-weight:800;color:#11305c">${role}</div>
                  </div>
                  <a href="${env.APP_URL}" style="display:inline-block;background:#1e4f86;color:#ffffff;padding:13px 18px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:800">
                    Abrir PaperHub
                  </a>
                  <p style="margin:22px 0 0;font-size:13px;line-height:1.5;color:#7b8aa3">
                    Si no esperabas este acceso, puedes ignorar este correo o contactar al administrador de tu organizacion.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
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
