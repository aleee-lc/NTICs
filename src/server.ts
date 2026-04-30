import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { env } from "./config/env";
import { categoriesRouter } from "./routes/categories";
import { documentsRouter } from "./routes/documents";
import { healthRouter } from "./routes/health";
import { organizationsRouter } from "./routes/organizations";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api", (_req, res) => {
  res.json({
    name: "PaperHub - Sistema de Gestion Documental API",
    status: "running",
  });
});

app.use("/api/health", healthRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/documents", documentsRouter);

app.get("/api/config/public", (_req, res) => {
  res.json({
    supabaseUrl: env.SUPABASE_URL ?? null,
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? null,
    storageBucket: env.SUPABASE_STORAGE_BUCKET,
  });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Error interno del servidor",
  });
};

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Servidor listo en http://localhost:${env.PORT}`);
});
