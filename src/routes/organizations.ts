import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { resolveUserIdFromRequest } from "../middleware/organization-context";

export const organizationsRouter = Router();

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

const uuidSchema = z.string().uuid();

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
