import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";

export const categoriesRouter = Router();

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).optional(),
});

categoriesRouter.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `
      select id, name, description, created_at
      from categories
      order by name asc
      `,
    );

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

categoriesRouter.post("/", async (req, res, next) => {
  const parsed = createCategorySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Payload inválido",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await pool.query(
      `
      insert into categories (name, description)
      values ($1, $2)
      on conflict (name) do update
      set description = excluded.description
      returning id, name, description, created_at
      `,
      [parsed.data.name, parsed.data.description ?? null],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

