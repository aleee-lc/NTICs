import { Router } from "express";
import { pool } from "../config/db";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res, next) => {
  try {
    await pool.query("select 1");
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

