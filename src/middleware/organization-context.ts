import { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { env } from "../config/env";

const uuidSchema = z.string().uuid();

interface OrganizationContext {
  organizationId: string;
  userId: string;
  membershipRole: "owner" | "admin" | "member" | "viewer";
}

interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface AuthenticatedRequest extends Request {
  authUser: AuthenticatedUser;
}

export interface OrganizationRequest extends AuthenticatedRequest {
  organizationContext: OrganizationContext;
}

export async function requireAuthenticatedUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    res.status(500).json({
      error: "Auth de Supabase no esta configurado en el servidor",
    });
    return;
  }

  const accessToken = resolveAccessToken(req);
  if (!accessToken) {
    res.status(401).json({
      error: "Authorization Bearer token es obligatorio",
    });
    return;
  }

  try {
    const authUser = await resolveSupabaseUser(accessToken);
    if (!authUser) {
      res.status(401).json({ error: "Sesion invalida o expirada" });
      return;
    }

    (req as AuthenticatedRequest).authUser = authUser;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireOrganizationContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const organizationId = resolveOrganizationId(req);
  const userId = resolveAuthenticatedUserId(req);

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
      [parsedOrganizationId.data, userId],
    );

    if (membership.rowCount === 0) {
      res.status(403).json({ error: "No tienes acceso a esta organizacion" });
      return;
    }

    (req as OrganizationRequest).organizationContext = {
      organizationId: parsedOrganizationId.data,
      userId,
      membershipRole: membership.rows[0].role,
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function resolveAuthenticatedUserId(req: Request): string {
  return (req as AuthenticatedRequest).authUser.id;
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

function resolveAccessToken(req: Request): string | null {
  const authorization = req.header("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const normalized = token.trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveSupabaseUser(accessToken: string): Promise<AuthenticatedUser | null> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`No se pudo validar la sesion en Supabase (${response.status})`);
  }

  const payload = (await response.json()) as { id?: string; email?: string | null };
  const parsedUserId = uuidSchema.safeParse(payload.id);
  if (!parsedUserId.success) {
    return null;
  }

  return {
    id: parsedUserId.data,
    email: payload.email ?? null,
  };
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
