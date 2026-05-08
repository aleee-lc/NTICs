import { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../config/db";

const uuidSchema = z.string().uuid();

interface OrganizationContext {
  organizationId: string;
  userId: string;
  membershipRole: "owner" | "admin" | "member" | "viewer";
}

export interface OrganizationRequest extends Request {
  organizationContext: OrganizationContext;
}

export async function requireOrganizationContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const organizationId = resolveOrganizationId(req);
  const userId = resolveUserIdFromRequest(req);

  if (!organizationId) {
    res.status(400).json({
      error: "organizationId es obligatorio (header x-organization-id o query organizationId)",
    });
    return;
  }

  const parsedOrganizationId = uuidSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    res.status(400).json({ error: "organizationId invalido" });
    return;
  }

  if (!userId) {
    res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
    return;
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success) {
    res.status(400).json({ error: "userId invalido" });
    return;
  }

  try {
    const membership = await pool.query<{
      role: OrganizationContext["membershipRole"];
    }>(
      `
      select role
      from organization_memberships
      where organization_id = $1 and user_id = $2
      limit 1
      `,
      [parsedOrganizationId.data, parsedUserId.data],
    );

    if (membership.rowCount === 0) {
      res.status(403).json({ error: "No tienes acceso a esta organizacion" });
      return;
    }

    (req as OrganizationRequest).organizationContext = {
      organizationId: parsedOrganizationId.data,
      userId: parsedUserId.data,
      membershipRole: membership.rows[0].role,
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function resolveUserIdFromRequest(req: Request): string | null {
  const headerUserId = req.header("x-user-id");
  if (headerUserId?.trim()) {
    return headerUserId.trim();
  }

  const queryUserId = asSingleString(req.query.userId);
  if (queryUserId) {
    return queryUserId;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    return null;
  }

  const bodyCandidates = [
    "userId",
    "createdBy",
    "uploadedBy",
    "reviewerId",
  ] as const;

  for (const key of bodyCandidates) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function hasOrganizationRole(
  context: OrganizationContext,
  allowedRoles: OrganizationContext["membershipRole"][],
): boolean {
  return allowedRoles.includes(context.membershipRole);
}

function resolveOrganizationId(req: Request): string | null {
  const headerOrganizationId = req.header("x-organization-id");
  if (headerOrganizationId?.trim()) {
    return headerOrganizationId.trim();
  }

  const queryOrganizationId = asSingleString(req.query.organizationId);
  if (queryOrganizationId) {
    return queryOrganizationId;
  }

  return null;
}

function asSingleString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "string") {
      const normalized = first.trim();
      return normalized.length > 0 ? normalized : null;
    }
  }

  return null;
}
