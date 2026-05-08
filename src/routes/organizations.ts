import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { resolveUserIdFromRequest } from "../middleware/organization-context";

export const organizationsRouter = Router();

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

const uuidSchema = z.string().uuid();
const organizationRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
const organizationParamsSchema = z.object({
  id: z.string().uuid(),
});
const memberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});
const addMemberSchema = z.object({
  email: z.string().trim().email(),
  role: organizationRoleSchema.default("member"),
});
const updateMemberSchema = z.object({
  role: organizationRoleSchema,
});

organizationsRouter.get("/", async (req, res, next) => {
  const userId = resolveUserIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return res.status(400).json({ error: "userId invalido" });
  }

  try {
    const result = await pool.query(
      `
      select
        o.id,
        o.name,
        o.slug,
        o.created_at,
        m.role,
        m.created_at as joined_at
      from organization_memberships m
      inner join organizations o on o.id = m.organization_id
      where m.user_id = $1
      order by o.name asc
      `,
      [parsedUserId.data],
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.post("/", async (req, res, next) => {
  const userId = resolveUserIdFromRequest(req);
  const parsedPayload = createOrganizationSchema.safeParse(req.body);

  if (!userId) {
    return res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success) {
    return res.status(400).json({ error: "userId invalido" });
  }

  if (!parsedPayload.success) {
    return res.status(400).json({
      error: "Payload invalido",
      details: parsedPayload.error.flatten().fieldErrors,
    });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const baseSlug = slugify(parsedPayload.data.name);
    let createdOrganization:
      | { id: string; name: string; slug: string; created_at: string }
      | undefined;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const slug =
        attempt === 0
          ? baseSlug
          : `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;

      try {
        const organizationResult = await client.query<{
          id: string;
          name: string;
          slug: string;
          created_at: string;
        }>(
          `
          insert into organizations (name, slug)
          values ($1, $2)
          returning id, name, slug, created_at
          `,
          [parsedPayload.data.name, slug],
        );

        createdOrganization = organizationResult.rows[0];
        break;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    if (!createdOrganization) {
      await client.query("rollback");
      return res.status(409).json({
        error: "No fue posible generar un slug unico para la organizacion",
      });
    }

    const membershipResult = await client.query<{ joined_at: string }>(
      `
      insert into organization_memberships (organization_id, user_id, role)
      values ($1, $2, 'owner')
      on conflict (organization_id, user_id) do update
      set role = 'owner'
      returning created_at as joined_at
      `,
      [createdOrganization.id, parsedUserId.data],
    );

    await client.query("commit");

    res.status(201).json({
      ...createdOrganization,
      role: "owner",
      joined_at: membershipResult.rows[0]?.joined_at ?? createdOrganization.created_at,
    });
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

organizationsRouter.get("/:id/members", async (req, res, next) => {
  const userId = resolveUserIdFromRequest(req);
  const parsedParams = organizationParamsSchema.safeParse(req.params);

  if (!userId) {
    return res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success || !parsedParams.success) {
    return res.status(400).json({ error: "Datos invalidos" });
  }

  try {
    const access = await getMembership(parsedParams.data.id, parsedUserId.data);
    if (!access) {
      return res.status(403).json({ error: "No tienes acceso a esta organizacion" });
    }

    const result = await pool.query(
      `
      select
        m.user_id,
        m.role,
        m.created_at as joined_at,
        p.email,
        p.full_name
      from organization_memberships m
      left join profiles p on p.id = m.user_id
      where m.organization_id = $1
      order by
        case m.role
          when 'owner' then 1
          when 'admin' then 2
          when 'member' then 3
          else 4
        end,
        coalesce(p.full_name, p.email, m.user_id::text) asc
      `,
      [parsedParams.data.id],
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.post("/:id/members", async (req, res, next) => {
  const userId = resolveUserIdFromRequest(req);
  const parsedParams = organizationParamsSchema.safeParse(req.params);
  const parsedPayload = addMemberSchema.safeParse(req.body);

  if (!userId) {
    return res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success || !parsedParams.success || !parsedPayload.success) {
    return res.status(400).json({
      error: "Datos invalidos",
      details: {
        params: parsedParams.success ? undefined : parsedParams.error.flatten().fieldErrors,
        body: parsedPayload.success ? undefined : parsedPayload.error.flatten().fieldErrors,
      },
    });
  }

  try {
    const access = await getMembership(parsedParams.data.id, parsedUserId.data);
    if (!access) {
      return res.status(403).json({ error: "No tienes acceso a esta organizacion" });
    }

    if (!["owner", "admin"].includes(access.role)) {
      return res.status(403).json({ error: "No tienes permisos para invitar miembros" });
    }

    if (parsedPayload.data.role === "owner" && access.role !== "owner") {
      return res.status(403).json({ error: "Solo un owner puede asignar owners" });
    }

    const profileResult = await pool.query<{ id: string; email: string; full_name: string | null }>(
      `
      select id, email, full_name
      from profiles
      where lower(email) = lower($1)
      limit 1
      `,
      [parsedPayload.data.email],
    );

    if (profileResult.rowCount === 0) {
      return res.status(404).json({
        error: "No existe una cuenta registrada con ese correo",
      });
    }

    const profile = profileResult.rows[0];
    const memberResult = await pool.query(
      `
      insert into organization_memberships (organization_id, user_id, role)
      values ($1, $2, $3)
      on conflict (organization_id, user_id) do update
      set role = excluded.role
      returning user_id, role, created_at as joined_at
      `,
      [parsedParams.data.id, profile.id, parsedPayload.data.role],
    );

    res.status(201).json({
      ...memberResult.rows[0],
      email: profile.email,
      full_name: profile.full_name,
    });
  } catch (error) {
    next(error);
  }
});

organizationsRouter.patch("/:id/members/:userId", async (req, res, next) => {
  const userId = resolveUserIdFromRequest(req);
  const parsedParams = memberParamsSchema.safeParse(req.params);
  const parsedPayload = updateMemberSchema.safeParse(req.body);

  if (!userId) {
    return res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success || !parsedParams.success || !parsedPayload.success) {
    return res.status(400).json({ error: "Datos invalidos" });
  }

  try {
    const access = await getMembership(parsedParams.data.id, parsedUserId.data);
    if (!access) {
      return res.status(403).json({ error: "No tienes acceso a esta organizacion" });
    }

    if (access.role !== "owner" && parsedPayload.data.role === "owner") {
      return res.status(403).json({ error: "Solo un owner puede asignar owners" });
    }

    if (!["owner", "admin"].includes(access.role)) {
      return res.status(403).json({ error: "No tienes permisos para cambiar roles" });
    }

    const target = await getMembership(parsedParams.data.id, parsedParams.data.userId);
    if (!target) {
      return res.status(404).json({ error: "Miembro no encontrado" });
    }

    if (target.role === "owner" && parsedPayload.data.role !== "owner") {
      const ownerCount = await countOwners(parsedParams.data.id);
      if (ownerCount <= 1) {
        return res.status(409).json({ error: "La organizacion debe conservar al menos un owner" });
      }
    }

    const result = await pool.query(
      `
      update organization_memberships
      set role = $3
      where organization_id = $1 and user_id = $2
      returning user_id, role, created_at as joined_at
      `,
      [parsedParams.data.id, parsedParams.data.userId, parsedPayload.data.role],
    );

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

organizationsRouter.delete("/:id/members/:userId", async (req, res, next) => {
  const userId = resolveUserIdFromRequest(req);
  const parsedParams = memberParamsSchema.safeParse(req.params);

  if (!userId) {
    return res.status(401).json({
      error: "userId es obligatorio (header x-user-id o query userId)",
    });
  }

  const parsedUserId = uuidSchema.safeParse(userId);
  if (!parsedUserId.success || !parsedParams.success) {
    return res.status(400).json({ error: "Datos invalidos" });
  }

  try {
    const access = await getMembership(parsedParams.data.id, parsedUserId.data);
    if (!access) {
      return res.status(403).json({ error: "No tienes acceso a esta organizacion" });
    }

    if (!["owner", "admin"].includes(access.role)) {
      return res.status(403).json({ error: "No tienes permisos para quitar miembros" });
    }

    const target = await getMembership(parsedParams.data.id, parsedParams.data.userId);
    if (!target) {
      return res.status(404).json({ error: "Miembro no encontrado" });
    }

    if (target.role === "owner") {
      const ownerCount = await countOwners(parsedParams.data.id);
      if (ownerCount <= 1) {
        return res.status(409).json({ error: "La organizacion debe conservar al menos un owner" });
      }
    }

    await pool.query(
      `
      delete from organization_memberships
      where organization_id = $1 and user_id = $2
      `,
      [parsedParams.data.id, parsedParams.data.userId],
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

function slugify(input: string): string {
  const normalized = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "organizacion";
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function getMembership(
  organizationId: string,
  userId: string,
): Promise<{ role: "owner" | "admin" | "member" | "viewer" } | null> {
  const result = await pool.query<{ role: "owner" | "admin" | "member" | "viewer" }>(
    `
    select role
    from organization_memberships
    where organization_id = $1 and user_id = $2
    limit 1
    `,
    [organizationId, userId],
  );

  return result.rows[0] ?? null;
}

async function countOwners(organizationId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `
    select count(*)::text as count
    from organization_memberships
    where organization_id = $1 and role = 'owner'
    `,
    [organizationId],
  );

  return Number(result.rows[0]?.count ?? 0);
}
