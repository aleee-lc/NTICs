# NTICs - Sistema de Gestion Documental Empresarial

Starter backend para el proyecto del PDF con:
- API REST en Node.js + Express + TypeScript.
- Esquema PostgreSQL orientado a Supabase.
- Soporte inicial para documentos, versiones, flujo de aprobacion y auditoria.
- Frontend en Angular con login, dashboard y modulo de subida de documentos.

## 1) Configurar base de datos en Supabase

1. Crea un proyecto en Supabase.
2. Ve a `SQL Editor`.
3. Ejecuta el script: `supabase/migrations/20260310_001_init.sql`.
4. Copia el connection string Postgres (URI) de Supabase.

## 2) Configurar variables de entorno

1. Copia `.env.example` a `.env`.
2. Reemplaza `DATABASE_URL` con tu URI real de Supabase.
3. Agrega `SUPABASE_URL` y `SUPABASE_ANON_KEY` (para login/upload en frontend).

Ejemplo:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres.nqygutjxnwzgkbpwiqjw:YOUR_PASSWORD@aws-0-us-west-2.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://nqygutjxnwzgkbpwiqjw.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_STORAGE_BUCKET=documentos
RESEND_API_KEY=YOUR_RESEND_API_KEY
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tu-correo@gmail.com
SMTP_PASS=TU_APP_PASSWORD_DE_GMAIL
MAIL_FROM=PaperHub <onboarding@resend.dev>
APP_URL=http://localhost:4200
```

El envio de correo es opcional. Para Gmail SMTP configura `SMTP_HOST`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM` y `APP_URL`. `SMTP_PASS` debe ser una App Password de Gmail,
no la contrasena normal de tu cuenta. Si no configuras SMTP, el backend puede usar
`RESEND_API_KEY` como fallback. Si no configuras ningun proveedor, agregar miembros sigue
funcionando, pero no se envia correo.

## 3) Backend: instalar y ejecutar

```bash
npm install
npm run dev
```

API disponible en:

`http://localhost:3000`

## 4) Frontend Angular: instalar y ejecutar

```bash
cd frontend
npm install
npm start
```

Frontend disponible en:

`http://localhost:4200`

El frontend consume la API en `http://localhost:3000` (config en `frontend/src/environments/environment.ts`).

## 5) Endpoints iniciales

- `GET /api/health`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/documents`
- `POST /api/documents`
- `POST /api/documents/:id/versions`
- `PATCH /api/documents/:id/status`
- `GET /api/documents/:id/audit`

## 6) Payloads base

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
