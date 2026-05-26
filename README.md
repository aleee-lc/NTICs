# PaperHub - Sistema de Gestión Documental Empresarial

Sistema full-stack para gestión de documentos empresariales con control de versiones, flujos de aprobación y multi-tenancy por organización.

**Stack:** Node.js + Express + TypeScript (backend) · Angular 21 (frontend) · PostgreSQL vía Supabase · Supabase Auth + Storage

## Funcionalidades

- Autenticación con Supabase Auth
- Multi-tenancy: organizaciones con roles (`owner`, `admin`, `member`, `viewer`)
- Gestión de categorías de documentos
- Carga, versionado y descarga de documentos desde Supabase Storage
- Flujo de aprobación: `draft → in_review → approved / rejected → archived`
- Registro de auditoría por acción y organización
- Notificaciones por correo al agregar miembros (SMTP Gmail o Resend como fallback)

---

## Configuración

### 1. Variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus valores reales de Supabase. Ver `.env.example` para la lista completa de variables.

### 2. Base de datos

Ejecuta las migraciones en orden desde `supabase/migrations/` usando el SQL Editor de Supabase:

```
20260310_001_init.sql
20260318_002_auth_users_integration.sql
20260319_003_profiles_hardening.sql
20260415_004_multitenant_organizations.sql
20260504_005_audit_organization_context.sql
20260525_006_storage_document_policies.sql
```

---

## Desarrollo

### Backend

```bash
npm install
npm run dev        # tsx watch, recarga automática
npm run check      # verifica TypeScript sin compilar
npm run build      # compila a dist/
```

API disponible en `http://localhost:3000`

### Frontend

```bash
cd frontend
npm install
npm start
```

Frontend disponible en `http://localhost:4200`

---

## API

### Health

| Método | Ruta         | Descripción          |
|--------|--------------|----------------------|
| GET    | `/api/health` | Estado de la base de datos |

### Organizaciones

| Método | Ruta                                  | Descripción                    | Rol mínimo |
|--------|---------------------------------------|--------------------------------|------------|
| GET    | `/api/organizations`                  | Organizaciones del usuario     | —          |
| POST   | `/api/organizations`                  | Crear organización             | —          |
| GET    | `/api/organizations/:id/members`      | Listar miembros                | viewer     |
| POST   | `/api/organizations/:id/members`      | Agregar / actualizar miembro   | admin      |
| PATCH  | `/api/organizations/:id/members/:uid` | Cambiar rol de miembro         | admin      |
| DELETE | `/api/organizations/:id/members/:uid` | Eliminar miembro               | admin      |

### Categorías

| Método | Ruta                  | Descripción              | Rol mínimo |
|--------|-----------------------|--------------------------|------------|
| GET    | `/api/categories`     | Listar categorías        | viewer     |
| GET    | `/api/categories/:id` | Detalle de categoría     | viewer     |
| POST   | `/api/categories`     | Crear categoría          | admin      |
| PUT    | `/api/categories/:id` | Actualizar categoría     | admin      |
| DELETE | `/api/categories/:id` | Eliminar categoría       | admin      |

### Documentos

| Método | Ruta                            | Descripción                        | Rol mínimo |
|--------|---------------------------------|------------------------------------|------------|
| GET    | `/api/documents`                | Listar documentos (con filtros)    | viewer     |
| POST   | `/api/documents`                | Crear documento + primera versión  | member     |
| GET    | `/api/documents/:id`            | Detalle con versiones y aprobaciones | viewer   |
| PUT    | `/api/documents/:id`            | Actualizar metadatos               | member     |
| DELETE | `/api/documents/:id`            | Eliminar documento                 | admin      |
| POST   | `/api/documents/:id/versions`   | Agregar nueva versión              | member     |
| PATCH  | `/api/documents/:id/status`     | Cambiar estado (aprobación)        | admin      |
| GET    | `/api/documents/:id/audit`      | Historial de auditoría             | viewer     |
| GET    | `/api/documents/:id/versions`   | Historial de versiones             | viewer     |

Los endpoints que requieren contexto de organización esperan el header `x-organization-id` y `x-user-id`.

---

## Despliegue

- **Backend:** Railway (`https://ntics-production.up.railway.app`)
- **Frontend:** Netlify (`https://paperhub-bypapulines.netlify.app`)

En producción, configurar `APP_URL` con la URL del frontend para CORS y links de correo.
