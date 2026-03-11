# NTICs - Sistema de Gestion Documental Empresarial

Starter backend para el proyecto del PDF con:
- API REST en Node.js + Express + TypeScript.
- Esquema PostgreSQL orientado a Supabase.
- Soporte inicial para documentos, versiones, flujo de aprobacion y auditoria.

## 1) Configurar base de datos en Supabase

1. Crea un proyecto en Supabase.
2. Ve a `SQL Editor`.
3. Ejecuta el script: `supabase/migrations/20260310_001_init.sql`.
4. Copia el connection string Postgres (URI) de Supabase.

## 2) Configurar variables de entorno

1. Copia `.env.example` a `.env`.
2. Reemplaza `DATABASE_URL` con tu URI real de Supabase.

Ejemplo:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres.nqygutjxnwzgkbpwiqjw:YOUR_PASSWORD@aws-0-us-west-2.pooler.supabase.com:6543/postgres
```

## 3) Instalar y ejecutar

```bash
npm install
npm run dev
```

API disponible en:

`http://localhost:3000`

## 4) Endpoints iniciales

- `GET /api/health`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/documents`
- `POST /api/documents`
- `POST /api/documents/:id/versions`
- `PATCH /api/documents/:id/status`
- `GET /api/documents/:id/audit`

## 5) Payloads base

Crear documento (`POST /api/documents`):

```json
{
  "title": "Politica de respaldo",
  "description": "Documento oficial de respaldos",
  "categoryId": "UUID_CATEGORIA",
  "createdBy": "UUID_USUARIO",
  "storagePath": "documentos/politica-respaldo-v1.pdf",
  "fileName": "politica-respaldo-v1.pdf",
  "mimeType": "application/pdf",
  "fileSize": 125500,
  "changeSummary": "Version inicial"
}
```

Agregar version (`POST /api/documents/:id/versions`):

```json
{
  "uploadedBy": "UUID_USUARIO",
  "storagePath": "documentos/politica-respaldo-v2.pdf",
  "fileName": "politica-respaldo-v2.pdf",
  "mimeType": "application/pdf",
  "fileSize": 131000,
  "changeSummary": "Actualizacion de politicas"
}
```

Cambio de estado (`PATCH /api/documents/:id/status`):

```json
{
  "status": "approved",
  "reviewerId": "UUID_REVISOR",
  "comments": "Aprobado por direccion"
}
```

## Notas

- `createdBy`, `uploadedBy` y `reviewerId` estan en formato UUID para integrarse con usuarios de Supabase Auth.
- Este arranque cubre la base tecnica; la siguiente fase recomendada es agregar autenticacion, autorizacion por roles y carga real de archivos a Supabase Storage.
