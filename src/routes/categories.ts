import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { type OrganizationRequest, requireOrganizationContext } from "../middleware/organization-context";

export const categoriesRouter = Router();

categoriesRouter.use(requireOrganizationContext);

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional(),
});

const updateCategorySchema = createCategorySchema;

const baseCategorySelect = `
  select
    c.id,
    c.name,
    c.description,
    c.created_at,
    count(d.id)::int as documents_count
  from categories c
  left join documents d
    on d.category_id = c.id
   and d.organization_id = c.organization_id
`;

categoriesRouter.get("/", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;

  try {
    const result = await pool.query(
      `
      ${baseCategorySelect}
      where c.organization_id = $1
      group by c.id
      order by name asc
      `,
      [context.organizationId],
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

categoriesRouter.get("/:id", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({
      error: "Parametro invalido",
      details: params.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await pool.query(
      `
      ${baseCategorySelect}
      where c.organization_id = $1 and c.id = $2
      group by c.id
      `,
      [context.organizationId, params.data.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Categoria no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

categoriesRouter.post("/", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const parsed = createCategorySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload invalido",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const insertResult = await pool.query(
      `
      insert into categories (organization_id, name, description)
      values ($1, $2, $3)
      returning id
      `,
      [context.organizationId, parsed.data.name, parsed.data.description ?? null],
    );

    const result = await pool.query(
      `
      ${baseCategorySelect}
      where c.organization_id = $1 and c.id = $2
      group by c.id
      `,
      [context.organizationId, insertResult.rows[0].id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        error: "Ya existe una categoria con ese nombre en esta organizacion",
      });
    }

    next(error);
  }
});

categoriesRouter.put("/:id", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);
  const parsed = updateCategorySchema.safeParse(req.body);

  if (!params.success || !parsed.success) {
    return res.status(400).json({
      error: "Datos invalidos",
      details: {
        params: params.success ? undefined : params.error.flatten().fieldErrors,
        body: parsed.success ? undefined : parsed.error.flatten().fieldErrors,
      },
    });
  }

  try {
    const updateResult = await pool.query(
      `
      update categories
      set name = $3, description = $4
      where organization_id = $1 and id = $2
      returning id
      `,
      [
        context.organizationId,
        params.data.id,
        parsed.data.name,
        parsed.data.description ?? null,
      ],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: "Categoria no encontrada" });
    }

    const result = await pool.query(
      `
      ${baseCategorySelect}
      where c.organization_id = $1 and c.id = $2
      group by c.id
      `,
      [context.organizationId, params.data.id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({
        error: "Ya existe una categoria con ese nombre en esta organizacion",
      });
    }

    next(error);
  }
});

categoriesRouter.delete("/:id", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({
      error: "Parametro invalido",
      details: params.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await pool.query(
      `
      with usage as (
        select count(*)::int as documents_count
        from documents
        where organization_id = $1 and category_id = $2
      ),
      deleted as (
        delete from categories
        where organization_id = $1 and id = $2
        returning id, name
      )
      select deleted.id, deleted.name, usage.documents_count
      from deleted
      cross join usage
      `,
      [context.organizationId, params.data.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Categoria no encontrada" });
    }

    res.json({
      id: result.rows[0].id,
      name: result.rows[0].name,
      unlinkedDocuments: result.rows[0].documents_count,
    });
  } catch (error) {
    next(error);
  }
});

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

