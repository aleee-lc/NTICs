import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";

export const documentsRouter = Router();

const documentStatusSchema = z.enum([
  "draft",
  "in_review",
  "approved",
  "rejected",
  "archived",
]);

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const listDocumentsQuerySchema = z.object({
  status: documentStatusSchema.optional(),
  search: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().optional(),
});

const createDocumentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().uuid().optional(),
  createdBy: z.string().uuid(),
  storagePath: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  changeSummary: z.string().trim().max(500).optional(),
});

const createVersionSchema = z.object({
  uploadedBy: z.string().uuid(),
  storagePath: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  changeSummary: z.string().trim().max(500).optional(),
});

const updateStatusSchema = z.object({
  status: documentStatusSchema,
  reviewerId: z.string().uuid().optional(),
  stepId: z.string().uuid().optional(),
  comments: z.string().trim().max(1000).optional(),
});

documentsRouter.get("/", async (req, res, next) => {
  const parsed = listDocumentsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Parámetros inválidos",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const values: string[] = [];
    const filters: string[] = [];

    if (parsed.data.status) {
      values.push(parsed.data.status);
      filters.push(`d.status = $${values.length}`);
    }

    if (parsed.data.search) {
      values.push(`%${parsed.data.search}%`);
      filters.push(
        `(d.title ilike $${values.length} or coalesce(d.description, '') ilike $${values.length})`,
      );
    }

    if (parsed.data.categoryId) {
      values.push(parsed.data.categoryId);
      filters.push(`d.category_id = $${values.length}`);
    }

    const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";

    const query = `
      select
        d.id,
        d.title,
        d.description,
        d.status,
        d.current_version,
        d.created_by,
        d.created_at,
        d.updated_at,
        c.id as category_id,
        c.name as category_name
      from documents d
      left join categories c on c.id = d.category_id
      ${whereClause}
      order by d.updated_at desc
      limit 100
    `;

    const result = await pool.query(query, values);
    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

documentsRouter.post("/", async (req, res, next) => {
  const parsed = createDocumentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload inválido",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const documentResult = await client.query(
      `
      insert into documents (title, description, category_id, created_by)
      values ($1, $2, $3, $4)
      returning id, status, current_version, created_at
      `,
      [
        parsed.data.title,
        parsed.data.description ?? null,
        parsed.data.categoryId ?? null,
        parsed.data.createdBy,
      ],
    );

    const document = documentResult.rows[0];

    await client.query(
      `
      insert into document_versions (
        document_id,
        version_number,
        storage_path,
        file_name,
        mime_type,
        file_size,
        change_summary,
        uploaded_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        document.id,
        document.current_version,
        parsed.data.storagePath,
        parsed.data.fileName,
        parsed.data.mimeType ?? null,
        parsed.data.fileSize ?? null,
        parsed.data.changeSummary ?? "Versión inicial",
        parsed.data.createdBy,
      ],
    );

    await client.query("commit");

    res.status(201).json({
      id: document.id,
      status: document.status,
      currentVersion: document.current_version,
      createdAt: document.created_at,
    });
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

documentsRouter.post("/:id/versions", async (req, res, next) => {
  const params = idParamsSchema.safeParse(req.params);
  const payload = createVersionSchema.safeParse(req.body);

  if (!params.success || !payload.success) {
    return res.status(400).json({
      error: "Datos inválidos",
      details: {
        params: params.success ? undefined : params.error.flatten().fieldErrors,
        body: payload.success ? undefined : payload.error.flatten().fieldErrors,
      },
    });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const lockResult = await client.query(
      `
      select current_version
      from documents
      where id = $1
      for update
      `,
      [params.data.id],
    );

    if (lockResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    const nextVersion = lockResult.rows[0].current_version + 1;

    await client.query(
      `
      insert into document_versions (
        document_id,
        version_number,
        storage_path,
        file_name,
        mime_type,
        file_size,
        change_summary,
        uploaded_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        params.data.id,
        nextVersion,
        payload.data.storagePath,
        payload.data.fileName,
        payload.data.mimeType ?? null,
        payload.data.fileSize ?? null,
        payload.data.changeSummary ?? null,
        payload.data.uploadedBy,
      ],
    );

    const updateResult = await client.query(
      `
      update documents
      set current_version = $2, updated_at = now()
      where id = $1
      returning id, current_version, updated_at
      `,
      [params.data.id, nextVersion],
    );

    await client.query("commit");
    res.status(201).json(updateResult.rows[0]);
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

documentsRouter.patch("/:id/status", async (req, res, next) => {
  const params = idParamsSchema.safeParse(req.params);
  const payload = updateStatusSchema.safeParse(req.body);

  if (!params.success || !payload.success) {
    return res.status(400).json({
      error: "Datos inválidos",
      details: {
        params: params.success ? undefined : params.error.flatten().fieldErrors,
        body: payload.success ? undefined : payload.error.flatten().fieldErrors,
      },
    });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const documentResult = await client.query(
      `
      update documents
      set status = $2, updated_at = now()
      where id = $1
      returning id, status, updated_at
      `,
      [params.data.id, payload.data.status],
    );

    if (documentResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    if (
      payload.data.reviewerId &&
      ["in_review", "approved", "rejected"].includes(payload.data.status)
    ) {
      await client.query(
        `
        insert into document_approvals (
          document_id,
          step_id,
          reviewer_id,
          decision,
          comments
        )
        values ($1, $2, $3, $4, $5)
        `,
        [
          params.data.id,
          payload.data.stepId ?? null,
          payload.data.reviewerId,
          payload.data.status,
          payload.data.comments ?? null,
        ],
      );
    }

    await client.query("commit");
    res.json(documentResult.rows[0]);
  } catch (error) {
    await client.query("rollback");
    next(error);
  } finally {
    client.release();
  }
});

documentsRouter.get("/:id/audit", async (req, res, next) => {
  const params = idParamsSchema.safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({
      error: "Parámetro inválido",
      details: params.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await pool.query(
      `
      select id, entity_type, entity_id, action, actor_id, old_data, new_data, created_at
      from audit_logs
      where entity_id = $1
      order by created_at desc
      limit 200
      `,
      [params.data.id],
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

