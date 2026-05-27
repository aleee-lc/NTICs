import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import {
  hasOrganizationRole,
  type OrganizationRequest,
  requireAuthenticatedUser,
  requireOrganizationContext,
} from "../middleware/organization-context";

export const documentsRouter = Router();

documentsRouter.use(requireAuthenticatedUser);
documentsRouter.use(requireOrganizationContext);

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
  createdBy: z.string().uuid().optional(),
  storagePath: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  changeSummary: z.string().trim().max(500).optional(),
});

const createVersionSchema = z.object({
  uploadedBy: z.string().uuid().optional(),
  storagePath: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(120).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  changeSummary: z.string().trim().max(500).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

const updateStatusSchema = z.object({
  status: documentStatusSchema,
  reviewerId: z.string().uuid().optional(),
  stepId: z.string().uuid().optional(),
  comments: z.string().trim().max(1000).optional(),
});

documentsRouter.get("/", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const parsed = listDocumentsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Parametros invalidos",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const values: string[] = [context.organizationId];
    const filters: string[] = ["d.organization_id = $1"];

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

    const whereClause = `where ${filters.join(" and ")}`;

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
        dv.storage_path as current_storage_path,
        dv.file_name as current_file_name,
        dv.mime_type as current_mime_type,
        c.id as category_id,
        c.name as category_name
      from documents d
      left join document_versions dv
        on dv.document_id = d.id
       and dv.organization_id = d.organization_id
       and dv.version_number = d.current_version
      left join categories c
        on c.id = d.category_id
       and c.organization_id = d.organization_id
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
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const parsed = createDocumentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload invalido",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    if (parsed.data.categoryId) {
      const categoryResult = await client.query(
        `
        select id
        from categories
        where id = $1 and organization_id = $2
        limit 1
        `,
        [parsed.data.categoryId, context.organizationId],
      );

      if (categoryResult.rowCount === 0) {
        await client.query("rollback");
        return res.status(404).json({ error: "Categoria no encontrada" });
      }
    }

    const documentResult = await client.query(
      `
      insert into documents (organization_id, title, description, category_id, created_by)
      values ($1, $2, $3, $4, $5)
      returning id, status, current_version, created_at
      `,
      [
        context.organizationId,
        parsed.data.title,
        parsed.data.description ?? null,
        parsed.data.categoryId ?? null,
        context.userId,
      ],
    );

    const document = documentResult.rows[0];

    await client.query(
      `
      insert into document_versions (
        organization_id,
        document_id,
        version_number,
        storage_path,
        file_name,
        mime_type,
        file_size,
        change_summary,
        uploaded_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        context.organizationId,
        document.id,
        document.current_version,
        parsed.data.storagePath,
        parsed.data.fileName,
        parsed.data.mimeType ?? null,
        parsed.data.fileSize ?? null,
        parsed.data.changeSummary ?? "Version inicial",
        context.userId,
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

documentsRouter.get("/:id", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({
      error: "Parametro invalido",
      details: params.error.flatten().fieldErrors,
    });
  }

  try {
    const documentResult = await pool.query(
      `
      select
        d.id,
        d.title,
        d.description,
        d.status,
        d.current_version,
        d.created_by,
        d.created_at,
        d.updated_at,
        dv.storage_path as current_storage_path,
        dv.file_name as current_file_name,
        dv.mime_type as current_mime_type,
        dv.file_size as current_file_size,
        c.id as category_id,
        c.name as category_name
      from documents d
      left join document_versions dv
        on dv.document_id = d.id
       and dv.organization_id = d.organization_id
       and dv.version_number = d.current_version
      left join categories c
        on c.id = d.category_id
       and c.organization_id = d.organization_id
      where d.id = $1 and d.organization_id = $2
      limit 1
      `,
      [params.data.id, context.organizationId],
    );

    if (documentResult.rowCount === 0) {
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    const [versionsResult, approvalsResult, auditResult] = await Promise.all([
      pool.query(
        `
        select
          v.id,
          v.version_number,
          v.storage_path,
          v.file_name,
          v.mime_type,
          v.file_size,
          v.change_summary,
          v.uploaded_by,
          p.email as uploaded_by_email,
          p.full_name as uploaded_by_name,
          v.created_at
        from document_versions v
        left join profiles p on p.id = v.uploaded_by
        where v.document_id = $1 and v.organization_id = $2
        order by v.version_number desc
        `,
        [params.data.id, context.organizationId],
      ),
      pool.query(
        `
        select
          a.id,
          a.step_id,
          s.role_name as step_role_name,
          s.step_order,
          a.reviewer_id,
          p.email as reviewer_email,
          p.full_name as reviewer_name,
          a.decision,
          a.comments,
          a.reviewed_at
        from document_approvals a
        left join approval_steps s
          on s.id = a.step_id
         and s.organization_id = a.organization_id
        left join profiles p on p.id = a.reviewer_id
        where a.document_id = $1 and a.organization_id = $2
        order by a.reviewed_at desc
        `,
        [params.data.id, context.organizationId],
      ),
      pool.query(
        `
        select id, entity_type, entity_id, action, actor_id, old_data, new_data, created_at
        from audit_logs
        where organization_id = $1
          and (
            entity_id = $2
            or (
              entity_type = 'document_versions'
              and entity_id in (
                select id from document_versions where document_id = $2 and organization_id = $1
              )
            )
            or (
              entity_type = 'document_approvals'
              and entity_id in (
                select id from document_approvals where document_id = $2 and organization_id = $1
              )
            )
          )
        order by created_at desc
        limit 200
        `,
        [context.organizationId, params.data.id],
      ),
    ]);

    res.json({
      ...documentResult.rows[0],
      versions: versionsResult.rows,
      approvals: approvalsResult.rows,
      audit: auditResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

documentsRouter.put("/:id", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);
  const payload = updateDocumentSchema.safeParse(req.body);

  if (!params.success || !payload.success) {
    return res.status(400).json({
      error: "Datos invalidos",
      details: {
        params: params.success ? undefined : params.error.flatten().fieldErrors,
        body: payload.success ? undefined : payload.error.flatten().fieldErrors,
      },
    });
  }

  if (!hasOrganizationRole(context, ["owner", "admin", "member"])) {
    return res.status(403).json({ error: "No tienes permisos para editar documentos" });
  }

  try {
    if (payload.data.categoryId) {
      const categoryResult = await pool.query(
        `
        select id
        from categories
        where id = $1 and organization_id = $2
        limit 1
        `,
        [payload.data.categoryId, context.organizationId],
      );

      if (categoryResult.rowCount === 0) {
        return res.status(404).json({ error: "Categoria no encontrada" });
      }
    }

    const result = await pool.query(
      `
      update documents
      set title = $3,
          description = $4,
          category_id = $5,
          updated_at = now()
      where id = $1 and organization_id = $2
      returning id, title, description, category_id, status, current_version, updated_at
      `,
      [
        params.data.id,
        context.organizationId,
        payload.data.title,
        payload.data.description ?? null,
        payload.data.categoryId ?? null,
      ],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

documentsRouter.post("/:id/versions", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);
  const payload = createVersionSchema.safeParse(req.body);

  if (!params.success || !payload.success) {
    return res.status(400).json({
      error: "Datos invalidos",
      details: {
        params: params.success ? undefined : params.error.flatten().fieldErrors,
        body: payload.success ? undefined : payload.error.flatten().fieldErrors,
      },
    });
  }

  if (!hasOrganizationRole(context, ["owner", "admin", "member"])) {
    return res.status(403).json({ error: "No tienes permisos para versionar documentos" });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const lockResult = await client.query(
      `
      select current_version
      from documents
      where id = $1 and organization_id = $2
      for update
      `,
      [params.data.id, context.organizationId],
    );

    if (lockResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    const nextVersion = lockResult.rows[0].current_version + 1;

    await client.query(
      `
      insert into document_versions (
        organization_id,
        document_id,
        version_number,
        storage_path,
        file_name,
        mime_type,
        file_size,
        change_summary,
        uploaded_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        context.organizationId,
        params.data.id,
        nextVersion,
        payload.data.storagePath,
        payload.data.fileName,
        payload.data.mimeType ?? null,
        payload.data.fileSize ?? null,
        payload.data.changeSummary ?? null,
        context.userId,
      ],
    );

    const updateResult = await client.query(
      `
      update documents
      set current_version = $2, updated_at = now()
      where id = $1 and organization_id = $3
      returning id, current_version, updated_at
      `,
      [params.data.id, nextVersion, context.organizationId],
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

documentsRouter.get("/:id/versions", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({
      error: "Parametro invalido",
      details: params.error.flatten().fieldErrors,
    });
  }

  try {
    const documentResult = await pool.query(
      `
      select id
      from documents
      where id = $1 and organization_id = $2
      limit 1
      `,
      [params.data.id, context.organizationId],
    );

    if (documentResult.rowCount === 0) {
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    const result = await pool.query(
      `
      select id, version_number, storage_path, file_name, mime_type, file_size, change_summary, uploaded_by, created_at
      from document_versions
      where document_id = $1 and organization_id = $2
      order by version_number desc
      `,
      [params.data.id, context.organizationId],
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

documentsRouter.patch("/:id/status", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);
  const payload = updateStatusSchema.safeParse(req.body);

  if (!params.success || !payload.success) {
    return res.status(400).json({
      error: "Datos invalidos",
      details: {
        params: params.success ? undefined : params.error.flatten().fieldErrors,
        body: payload.success ? undefined : payload.error.flatten().fieldErrors,
      },
    });
  }

  if (
    ["approved", "rejected"].includes(payload.data.status) &&
    !hasOrganizationRole(context, ["owner", "admin"])
  ) {
    return res.status(403).json({ error: "No tienes permisos para aprobar o rechazar documentos" });
  }

  if (payload.data.status === "archived" && !hasOrganizationRole(context, ["owner", "admin"])) {
    return res.status(403).json({ error: "No tienes permisos para archivar documentos" });
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const documentResult = await client.query(
      `
      update documents
      set status = $2, updated_at = now()
      where id = $1 and organization_id = $3
      returning id, status, updated_at
      `,
      [params.data.id, payload.data.status, context.organizationId],
    );

    if (documentResult.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    if (payload.data.stepId) {
      const stepResult = await client.query(
        `
        select id
        from approval_steps
        where id = $1 and organization_id = $2
        limit 1
        `,
        [payload.data.stepId, context.organizationId],
      );

      if (stepResult.rowCount === 0) {
        await client.query("rollback");
        return res.status(404).json({ error: "Paso de aprobacion no encontrado" });
      }
    }

    if (["in_review", "approved", "rejected"].includes(payload.data.status)) {
      await client.query(
        `
        insert into document_approvals (
          organization_id,
          document_id,
          step_id,
          reviewer_id,
          decision,
          comments
        )
        values ($1, $2, $3, $4, $5, $6)
        `,
        [
          context.organizationId,
          params.data.id,
          payload.data.stepId ?? null,
          context.userId,
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

documentsRouter.delete("/:id", async (req, res, next) => {
  const context = (req as unknown as OrganizationRequest).organizationContext;
  const params = idParamsSchema.safeParse(req.params);

  if (!params.success) {
    return res.status(400).json({
      error: "Parametro invalido",
      details: params.error.flatten().fieldErrors,
    });
  }

  if (!hasOrganizationRole(context, ["owner", "admin"])) {
    return res.status(403).json({ error: "No tienes permisos para eliminar documentos" });
  }

  try {
    const result = await pool.query(
      `
      delete from documents
      where id = $1 and organization_id = $2
      returning id
      `,
      [params.data.id, context.organizationId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

documentsRouter.get("/:id/audit", async (req, res, next) => {
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
      select id, entity_type, entity_id, action, actor_id, old_data, new_data, created_at
      from audit_logs
      where organization_id = $1 and entity_id = $2
      order by created_at desc
      limit 200
      `,
      [context.organizationId, params.data.id],
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});
