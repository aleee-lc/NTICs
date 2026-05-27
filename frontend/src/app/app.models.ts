export type PanelId = 'overview' | 'documents' | 'upload' | 'categories' | 'members';
export type AuthView = 'login' | 'register';
export type OnboardingView = 'choice' | 'create' | 'invited';
export type AppView = 'loading' | 'config-error' | 'landing' | 'auth' | 'onboarding' | 'workspace';
export type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'archived';
export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface PublicConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  storageBucket: string | null;
}

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  created_at: string;
  joined_at?: string;
}

export interface OrganizationMember {
  user_id: string;
  role: OrganizationRole;
  joined_at: string;
  email: string | null;
  full_name: string | null;
}

export interface CategoryItem {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  documents_count: number;
}

export interface DocumentItem {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  status: DocumentStatus;
  current_version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  current_storage_path: string | null;
  current_file_name: string | null;
  current_mime_type: string | null;
}

export interface CategoryDeleteResponse {
  id: string;
  name: string;
  unlinkedDocuments: number;
}

export interface DocumentVersionItem {
  id: string;
  version_number: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  change_summary: string | null;
  uploaded_by: string;
  uploaded_by_email?: string | null;
  uploaded_by_name?: string | null;
  created_at: string;
}

export interface DocumentApprovalItem {
  id: string;
  reviewer_id: string;
  reviewer_email: string | null;
  reviewer_name: string | null;
  decision: DocumentStatus;
  comments: string | null;
  reviewed_at: string;
  step_role_name?: string | null;
}

export interface AuditLogItem {
  id: number;
  entity_type: string;
  action: string;
  actor_id: string | null;
  created_at: string;
}

export interface DocumentDetail extends DocumentItem {
  current_file_size: number | null;
  versions: DocumentVersionItem[];
  approvals: DocumentApprovalItem[];
  audit: AuditLogItem[];
}
