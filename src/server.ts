import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { env } from "./config/env";
import { categoriesRouter } from "./routes/categories";
import { documentsRouter } from "./routes/documents";
import { healthRouter } from "./routes/health";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "NTICs - Sistema de Gestión Documental API",
    status: "running",
  });
});

app.use("/api/health", healthRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/documents", documentsRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Error interno del servidor",
  });
};

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`API escuchando en http://localhost:${env.PORT}`);
});

