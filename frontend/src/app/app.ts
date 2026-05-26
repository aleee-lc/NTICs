import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../environments/environment';

type PanelId = 'overview' | 'documents' | 'upload' | 'categories' | 'members';
type AuthView = 'login' | 'register';
type OnboardingView = 'choice' | 'create' | 'invited';
type AppView = 'loading' | 'config-error' | 'landing' | 'auth' | 'onboarding' | 'workspace';
type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'archived';
type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';

interface PublicConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  storageBucket: string | null;
}

interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  created_at: string;
  joined_at?: string;
}

interface OrganizationMember {
  user_id: string;
  role: OrganizationRole;
  joined_at: string;
  email: string | null;
  full_name: string | null;
}

interface CategoryItem {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  documents_count: number;
}

interface DocumentItem {
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

interface CategoryDeleteResponse {
  id: string;
  name: string;
  unlinkedDocuments: number;
}

interface DocumentVersionItem {
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

interface DocumentApprovalItem {
  id: string;
  reviewer_id: string;
  reviewer_email: string | null;
  reviewer_name: string | null;
  decision: DocumentStatus;
  comments: string | null;
  reviewed_at: string;
  step_role_name?: string | null;
}

interface AuditLogItem {
  id: number;
  entity_type: string;
  action: string;
  actor_id: string | null;
  created_at: string;
}

interface DocumentDetail extends DocumentItem {
  current_file_size: number | null;
  versions: DocumentVersionItem[];
  approvals: DocumentApprovalItem[];
  audit: AuditLogItem[];
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  private static readonly HTTP_TIMEOUT_MS = 10000;
  private static readonly ORG_STORAGE_KEY_PREFIX = 'paperhub.activeOrganization.';

  readonly activePanel = signal<PanelId>('overview');
  readonly authView = signal<AuthView>('login');
  readonly isLoading = signal(true);
  readonly authMessage = signal('');
  readonly uploadMessage = signal('');
  readonly documentsMessage = signal('');
  readonly categoryMessage = signal('');
  readonly configError = signal('');
  readonly session = signal<Session | null>(null);
  readonly organizations = signal<OrganizationItem[]>([]);
  readonly members = signal<OrganizationMember[]>([]);
  readonly activeOrganizationId = signal('');
  readonly organizationsMessage = signal('');
  readonly membersMessage = signal('');
  readonly categories = signal<CategoryItem[]>([]);
  readonly documents = signal<DocumentItem[]>([]);
  readonly selectedDocument = signal<DocumentDetail | null>(null);
  readonly isLoadingDocumentDetail = signal(false);
  readonly searchTerm = signal('');
  readonly documentCategoryFilter = signal('');
  readonly isCategoryFormOpen = signal(false);
  readonly editingCategoryId = signal<string | null>(null);
  readonly isSavingCategory = signal(false);
  readonly isCreatingOrganization = signal(false);
  readonly isUserMenuOpen = signal(false);
  readonly isOrgCreateDropdownOpen = signal(false);
  readonly isSidebarCollapsed = signal(false);
  readonly showLanding = signal(true);
  readonly isLoadingOrgs = signal(false);
  readonly isCreatingFirstOrg = signal(false);
  readonly uploadProgress = signal(0);
  readonly documentStatusFilter = signal('');
  readonly onboardingView = signal<OnboardingView>('choice');
  readonly apiBase = environment.apiBaseUrl;

  readonly activeOrganization = computed(() =>
    this.organizations().find((organization) => organization.id === this.activeOrganizationId()) ?? null,
  );
  readonly canManageMembers = computed(() =>
    ['owner', 'admin'].includes(this.activeOrganization()?.role ?? ''),
  );
  readonly canApproveDocuments = computed(() =>
    ['owner', 'admin'].includes(this.activeOrganization()?.role ?? ''),
  );
  readonly canWriteDocuments = computed(() =>
    ['owner', 'admin', 'member'].includes(this.activeOrganization()?.role ?? ''),
  );

  readonly appView = computed((): AppView => {
    if (this.isLoading()) return 'loading';
    if (this.configError()) return 'config-error';
    if (!this.session()) return this.showLanding() ? 'landing' : 'auth';
    if (this.organizations().length === 0 && !this.isLoadingOrgs()) return 'onboarding';
    return 'workspace';
  });

  readonly totalDocuments = computed(() => this.documents().length);
  readonly inReviewDocuments = computed(
    () => this.documents().filter((doc) => doc.status === 'in_review').length,
  );
  readonly approvedDocuments = computed(
    () => this.documents().filter((doc) => doc.status === 'approved').length,
  );
  readonly recentDocuments = computed(() =>
    [...this.documents()]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 6),
  );

  readonly filteredCategories = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const items = this.categories();

    if (!term) {
      return items;
    }

    return items.filter((category) => {
      const name = category.name.toLowerCase();
      const description = (category.description ?? '').toLowerCase();
      return name.includes(term) || description.includes(term);
    });
  });

  readonly visibleDocuments = computed(() => {
    const categoryFilter = this.documentCategoryFilter();
    const statusFilter = this.documentStatusFilter();
    const term = this.searchTerm().trim().toLowerCase();

    return this.documents()
      .filter((document) => !categoryFilter || document.category_id === categoryFilter)
      .filter((document) => !statusFilter || document.status === statusFilter)
      .filter((document) => {
        if (!term) {
          return true;
        }

        const status = this.statusLabel(document.status).toLowerCase();
        return (
          document.title.toLowerCase().includes(term) ||
          (document.category_name ?? '').toLowerCase().includes(term) ||
          (document.current_file_name ?? '').toLowerCase().includes(term) ||
          status.includes(term)
        );
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  });

  readonly currentUserName = computed(() => {
    const user = this.session()?.user;

    if (!user) {
      return '';
    }

    const metadata = user.user_metadata as Record<string, unknown> | undefined;
    const fullName = typeof metadata?.['full_name'] === 'string' ? metadata['full_name'].trim() : '';

    return fullName || user.email || 'Usuario';
  });

  readonly currentUserInitials = computed(() => {
    const name = this.currentUserName();
    if (!name) {
      return 'U';
    }

    const pieces = name
      .split(' ')
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (pieces.length === 1) {
      return pieces[0].slice(0, 1).toUpperCase();
    }

    return `${pieces[0].slice(0, 1)}${pieces[1].slice(0, 1)}`.toUpperCase();
  });

  loginEmail = '';
  loginPassword = '';

  registerName = '';
  registerEmail = '';
  registerPassword = '';
  registerConfirmPassword = '';

  docTitle = '';
  docDescription = '';
  docCategoryId = '';
  docChangeSummary = 'Version inicial';
  selectedFile: File | null = null;

  categoryName = '';
  categoryDescription = '';

  inviteEmail = '';
  inviteRole: OrganizationRole = 'member';

  detailTitle = '';
  detailDescription = '';
  detailCategoryId = '';
  approvalComments = '';
  versionChangeSummary = '';
  selectedVersionFile: File | null = null;
  newOrgName = '';
  workspaceNewOrgName = '';

  private supabase: SupabaseClient | null = null;
  private storageBucket = 'documentos';
  private unsubscribeAuth: (() => void) | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly elementRef: ElementRef<HTMLElement>,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const config = await this.loadPublicConfig();

      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        this.configError.set(
          'Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el backend (.env). Configuralos y reinicia.',
        );
        return;
      }

      this.storageBucket = config.storageBucket ?? 'documentos';
      this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

      try {
        await this.syncCurrentSession();
        await this.handleSessionChange(this.session());
      } catch (error) {
        console.warn('No se pudo restaurar la sesion al iniciar:', error);
        this.resetOrganizationContext();
        this.session.set(null);
        this.authMessage.set(
          'No se pudo validar la sesion actual. Puedes iniciar sesion manualmente.',
        );
      }

      const authListener = this.supabase.auth.onAuthStateChange((_event, session) => {
        void this.handleSessionChange(session);
      });

      this.unsubscribeAuth = () => authListener.data.subscription.unsubscribe();
    } catch (error) {
      this.configError.set(this.readError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeAuth?.();
  }

  openPanel(panel: PanelId): void {
    this.activePanel.set(panel);
    this.documentsMessage.set('');
    this.categoryMessage.set('');
    this.membersMessage.set('');
    this.isUserMenuOpen.set(false);

    if (panel === 'members') {
      void this.loadMembers();
    }
  }

  toggleSidebar(): void {
    this.isSidebarCollapsed.update((value) => !value);
  }

  setAuthView(view: AuthView): void {
    this.authView.set(view);
    this.authMessage.set('');
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchTerm.set(input.value);
  }

  setDocumentCategoryFilter(value: string): void {
    this.documentCategoryFilter.set(value);
  }

  clearDocumentFilters(): void {
    this.searchTerm.set('');
    this.documentCategoryFilter.set('');
    this.documentStatusFilter.set('');
  }

  goToAuth(view: AuthView): void {
    this.showLanding.set(false);
    this.authView.set(view);
    this.authMessage.set('');
  }

  setDocumentStatusFilter(value: string): void {
    this.documentStatusFilter.set(value);
  }

  async refreshOrganizations(): Promise<void> {
    this.organizationsMessage.set('Verificando acceso...');
    await this.loadOrganizations();
    if (this.organizations().length === 0) {
      this.organizationsMessage.set('Aun no tienes acceso a ninguna organizacion.');
    }
  }

  async createFirstOrganization(): Promise<void> {
    const name = this.newOrgName.trim();
    if (name.length < 2) {
      this.organizationsMessage.set('El nombre debe tener al menos 2 caracteres.');
      return;
    }

    this.isCreatingFirstOrg.set(true);
    this.organizationsMessage.set('');

    try {
      const created = await firstValueFrom(
        this.http
          .post<OrganizationItem>(`${this.apiBase}/api/organizations`, { name }, { headers: this.authHeaders() })
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      this.organizations.set([created]);
      this.activeOrganizationId.set(created.id);
      this.persistActiveOrganizationId(created.id);
      this.newOrgName = '';
      await this.refreshData();
    } catch (error) {
      this.organizationsMessage.set(this.readError(error));
    } finally {
      this.isCreatingFirstOrg.set(false);
    }
  }

  onOrganizationChange(event: Event): void {
    const input = event.target as HTMLSelectElement;
    const organizationId = input.value;

    this.activeOrganizationId.set(organizationId);
    this.persistActiveOrganizationId(organizationId);
    this.cancelCategoryForm();
    this.documentCategoryFilter.set('');
    this.resetUploadForm();
    this.resetDocumentDetail();
    this.members.set([]);
    this.documentsMessage.set('');
    this.uploadMessage.set('');
    this.categoryMessage.set('');
    this.membersMessage.set('');

    if (!organizationId) {
      this.categories.set([]);
      this.documents.set([]);
      this.members.set([]);
      this.organizationsMessage.set('Selecciona una organizacion para continuar.');
      return;
    }

    this.organizationsMessage.set('');
    void this.refreshData();
  }

  toggleOrgCreateDropdown(): void {
    this.isOrgCreateDropdownOpen.update((v) => !v);
    if (!this.isOrgCreateDropdownOpen()) {
      this.workspaceNewOrgName = '';
      this.organizationsMessage.set('');
    }
  }

  async submitWorkspaceOrgCreate(): Promise<void> {
    if (this.isCreatingOrganization()) {
      return;
    }

    const name = this.workspaceNewOrgName.trim();
    if (name.length < 2) {
      this.organizationsMessage.set('El nombre debe tener al menos 2 caracteres.');
      return;
    }

    this.isCreatingOrganization.set(true);
    this.organizationsMessage.set('');

    try {
      const created = await firstValueFrom(
        this.http
          .post<OrganizationItem>(
            `${this.apiBase}/api/organizations`,
            { name },
            { headers: this.authHeaders() },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      const nextOrganizations = [...this.organizations(), created].sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
      );

      this.organizations.set(nextOrganizations);
      this.activeOrganizationId.set(created.id);
      this.persistActiveOrganizationId(created.id);
      this.isOrgCreateDropdownOpen.set(false);
      this.workspaceNewOrgName = '';
      await this.refreshData();
    } catch (error) {
      this.organizationsMessage.set(this.readError(error));
    } finally {
      this.isCreatingOrganization.set(false);
    }
  }

  organizationRoleLabel(role: OrganizationItem['role']): string {
    const labels: Record<OrganizationRole, string> = {
      owner: 'Owner',
      admin: 'Admin',
      member: 'Member',
      viewer: 'Viewer',
    };

    return labels[role];
  }

  memberDisplayName(member: OrganizationMember): string {
    return member.full_name || member.email || `Usuario ${member.user_id.slice(0, 6)}`;
  }

  async login(): Promise<void> {
    if (!this.supabase) return;
    if (!this.loginEmail || !this.loginPassword) {
      this.authMessage.set('Captura correo y contrasena.');
      return;
    }

    this.authMessage.set('Validando credenciales...');
    const normalizedEmail = this.loginEmail.trim().toLowerCase();
    const { error } = await this.supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: this.loginPassword,
    });

    if (error) {
      this.authMessage.set(this.mapAuthErrorMessage(error.message));
      return;
    }

    this.authMessage.set('Sesion iniciada.');
  }

  async createAccount(): Promise<void> {
    if (!this.supabase) return;
    if (!this.registerEmail || !this.registerPassword || !this.registerConfirmPassword) {
      this.authMessage.set('Completa correo, contrasena y confirmacion.');
      return;
    }

    if (this.registerPassword.length < 6) {
      this.authMessage.set('La contrasena debe tener al menos 6 caracteres.');
      return;
    }

    if (this.registerPassword !== this.registerConfirmPassword) {
      this.authMessage.set('Las contrasenas no coinciden.');
      return;
    }

    this.authMessage.set('Creando cuenta...');
    const normalizedEmail = this.registerEmail.trim().toLowerCase();
    const { data, error } = await this.supabase.auth.signUp({
      email: normalizedEmail,
      password: this.registerPassword,
      options: {
        data: {
          full_name: this.registerName.trim() || undefined,
        },
      },
    });

    if (error) {
      this.authMessage.set(this.mapAuthErrorMessage(error.message));
      return;
    }

    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      this.authMessage.set(
        'Este correo ya estaba registrado. La contrasena no se cambio. Usa "Recuperar contrasena".',
      );
      this.authView.set('login');
      this.loginEmail = normalizedEmail;
      return;
    }

    this.loginEmail = normalizedEmail;
    this.loginPassword = '';
    this.registerName = '';
    this.registerEmail = '';
    this.registerPassword = '';
    this.registerConfirmPassword = '';
    this.authView.set('login');

    if (data.session) {
      this.authMessage.set('Cuenta creada y sesion iniciada.');
      return;
    }

    this.authMessage.set('Cuenta creada. Revisa tu correo y luego inicia sesion.');
  }

  async sendPasswordReset(): Promise<void> {
    if (!this.supabase) return;

    const email = this.loginEmail.trim().toLowerCase();
    if (!email) {
      this.authMessage.set('Escribe tu correo y luego presiona "Recuperar contrasena".');
      return;
    }

    this.authMessage.set('Enviando correo de recuperacion...');
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    if (error) {
      this.authMessage.set(this.mapAuthErrorMessage(error.message));
      return;
    }

    this.authMessage.set('Revisa tu correo. Te enviamos el enlace para cambiar la contrasena.');
  }

  async logout(): Promise<void> {
    if (!this.supabase) return;
    this.isUserMenuOpen.set(false);
    this.showLanding.set(true);
    await this.supabase.auth.signOut();
  }

  toggleUserMenu(): void {
    this.isUserMenuOpen.update((value) => !value);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    const hostElement = this.elementRef.nativeElement;

    if (this.isUserMenuOpen()) {
      const menuContainer = hostElement.querySelector('.user-menu');
      if (!target || !menuContainer?.contains(target)) {
        this.isUserMenuOpen.set(false);
      }
    }

    if (this.isOrgCreateDropdownOpen()) {
      const orgWrap = hostElement.querySelector('.org-create-wrap');
      if (!target || !orgWrap?.contains(target)) {
        this.isOrgCreateDropdownOpen.set(false);
        this.workspaceNewOrgName = '';
        this.organizationsMessage.set('');
      }
    }
  }

  async refreshData(): Promise<void> {
    if (!this.session()) return;

    if (!this.activeOrganizationId()) {
      this.categories.set([]);
      this.documents.set([]);
      this.members.set([]);
      this.resetDocumentDetail();
      this.documentCategoryFilter.set('');
      this.uploadMessage.set('Selecciona una organizacion para subir documentos.');
      this.documentsMessage.set('Selecciona una organizacion para cargar documentos.');
      this.categoryMessage.set('Selecciona una organizacion para administrar categorias.');
      this.membersMessage.set('Selecciona una organizacion para administrar miembros.');
      return;
    }

    try {
      const [categories, documents] = await Promise.all([this.fetchCategories(), this.fetchDocuments()]);
      this.categories.set(categories);
      this.documents.set(documents);
      this.uploadMessage.set('');
      this.documentsMessage.set('');
      const selected = this.selectedDocument();
      if (selected) {
        const stillExists = documents.some((document) => document.id === selected.id);
        if (stillExists) {
          await this.openDocumentDetail(selected.id, false);
        } else {
          this.resetDocumentDetail();
        }
      }
    } catch (error) {
      this.uploadMessage.set(this.readError(error));
    }
  }

  async loadMembers(): Promise<void> {
    if (!this.activeOrganizationId() || !this.session()) {
      this.members.set([]);
      this.membersMessage.set('Selecciona una organizacion para ver miembros.');
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http
          .get<{ items: OrganizationMember[] }>(
            `${this.apiBase}/api/organizations/${this.activeOrganizationId()}/members`,
            { headers: this.authHeaders() },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      this.members.set(response.items ?? []);
      this.membersMessage.set('');
    } catch (error) {
      this.membersMessage.set(this.readError(error));
    }
  }

  async inviteMember(): Promise<void> {
    if (!this.activeOrganizationId()) {
      this.membersMessage.set('Selecciona una organizacion para invitar miembros.');
      return;
    }

    const email = this.inviteEmail.trim().toLowerCase();
    if (!email) {
      this.membersMessage.set('Captura el correo del usuario.');
      return;
    }

    try {
      this.membersMessage.set('Agregando miembro...');
      await firstValueFrom(
        this.http
          .post(
            `${this.apiBase}/api/organizations/${this.activeOrganizationId()}/members`,
            { email, role: this.inviteRole },
            { headers: this.authHeaders() },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      this.inviteEmail = '';
      this.inviteRole = 'member';
      await this.loadMembers();
      this.membersMessage.set('Miembro agregado o actualizado.');
    } catch (error) {
      this.membersMessage.set(this.readError(error));
    }
  }

  async updateMemberRole(member: OrganizationMember, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const nextRole = select.value as OrganizationRole;

    try {
      await firstValueFrom(
        this.http
          .patch(
            `${this.apiBase}/api/organizations/${this.activeOrganizationId()}/members/${member.user_id}`,
            { role: nextRole },
            { headers: this.authHeaders() },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );
      await this.loadMembers();
      await this.loadOrganizations();
      this.membersMessage.set('Rol actualizado.');
    } catch (error) {
      this.membersMessage.set(this.readError(error));
      await this.loadMembers();
    }
  }

  async removeMember(member: OrganizationMember): Promise<void> {
    const confirmed = window.confirm(`Quitar a ${this.memberDisplayName(member)} de la organizacion.`);
    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(
        this.http
          .delete(`${this.apiBase}/api/organizations/${this.activeOrganizationId()}/members/${member.user_id}`, {
            headers: this.authHeaders(),
          })
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );
      await this.loadMembers();
      this.membersMessage.set('Miembro eliminado.');
    } catch (error) {
      this.membersMessage.set(this.readError(error));
    }
  }

  openCreateCategoryForm(): void {
    if (!this.activeOrganizationId()) {
      this.categoryMessage.set('Selecciona una organizacion antes de crear categorias.');
      return;
    }

    this.editingCategoryId.set(null);
    this.categoryName = '';
    this.categoryDescription = '';
    this.categoryMessage.set('');
    this.isCategoryFormOpen.set(true);
  }

  startEditCategory(category: CategoryItem): void {
    this.editingCategoryId.set(category.id);
    this.categoryName = category.name;
    this.categoryDescription = category.description ?? '';
    this.categoryMessage.set('');
    this.isCategoryFormOpen.set(true);
  }

  cancelCategoryForm(clearMessage = true): void {
    this.isCategoryFormOpen.set(false);
    this.editingCategoryId.set(null);
    this.categoryName = '';
    this.categoryDescription = '';
    if (clearMessage) {
      this.categoryMessage.set('');
    }
  }

  async saveCategory(): Promise<void> {
    if (!this.activeOrganizationId()) {
      this.categoryMessage.set('Selecciona una organizacion antes de guardar categorias.');
      return;
    }

    const name = this.categoryName.trim();
    if (!name) {
      this.categoryMessage.set('El nombre de la categoria es obligatorio.');
      return;
    }

    if (name.length < 2) {
      this.categoryMessage.set('El nombre debe tener al menos 2 caracteres.');
      return;
    }

    this.isSavingCategory.set(true);
    this.categoryMessage.set(this.editingCategoryId() ? 'Guardando cambios...' : 'Creando categoria...');

    const payload = {
      name,
      description: this.categoryDescription.trim() || undefined,
    };

    try {
      const editingId = this.editingCategoryId();
      let successMessage = 'Categoria creada.';

      if (editingId) {
        await firstValueFrom(
          this.http.put(`${this.apiBase}/api/categories/${editingId}`, payload, {
            headers: this.authHeaders(true),
          }),
        );
        successMessage = 'Categoria actualizada.';
      } else {
        await firstValueFrom(
          this.http.post(`${this.apiBase}/api/categories`, payload, {
            headers: this.authHeaders(true),
          }),
        );
      }

      await this.refreshData();
      this.cancelCategoryForm(false);
      this.categoryMessage.set(successMessage);
    } catch (error) {
      this.categoryMessage.set(this.readError(error));
    } finally {
      this.isSavingCategory.set(false);
    }
  }

  async deleteCategory(category: CategoryItem): Promise<void> {
    if (!this.activeOrganizationId()) {
      this.categoryMessage.set('Selecciona una organizacion antes de eliminar categorias.');
      return;
    }

    const confirmed = window.confirm(
      `Eliminar categoria "${category.name}". Los documentos quedaran sin categoria.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.delete<CategoryDeleteResponse>(`${this.apiBase}/api/categories/${category.id}`, {
          headers: this.authHeaders(true),
        }),
      );

      if (this.documentCategoryFilter() === category.id) {
        this.documentCategoryFilter.set('');
      }

      await this.refreshData();
      this.categoryMessage.set(
        `Categoria eliminada. Documentos desvinculados: ${response.unlinkedDocuments}.`,
      );
    } catch (error) {
      this.categoryMessage.set(this.readError(error));
    }
  }

  viewCategoryDocuments(categoryId: string): void {
    this.documentCategoryFilter.set(categoryId);
    this.activePanel.set('documents');
    this.documentsMessage.set('Filtro aplicado por categoria.');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  async uploadDocument(): Promise<void> {
    if (!this.supabase) return;
    const currentSession = this.session();
    const organizationId = this.activeOrganizationId();

    if (!currentSession) {
      this.uploadMessage.set('Inicia sesion para subir documentos.');
      return;
    }

    if (!organizationId) {
      this.uploadMessage.set('Selecciona una organizacion para subir documentos.');
      return;
    }

    if (!this.docTitle.trim()) {
      this.uploadMessage.set('El titulo es obligatorio.');
      return;
    }

    if (!this.selectedFile) {
      this.uploadMessage.set('Selecciona un archivo.');
      return;
    }

    const fileError = this.validateFile(this.selectedFile);
    if (fileError) {
      this.uploadMessage.set(fileError);
      return;
    }

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      this.uploadProgress.set(8);
      this.uploadMessage.set('Subiendo archivo...');
      progressInterval = setInterval(() => {
        this.uploadProgress.update((p) => Math.min(p + 4, 72));
      }, 250);

      const storagePath = this.buildStoragePath(
        organizationId,
        currentSession.user.id,
        this.selectedFile.name,
      );

      const { error: storageError } = await this.supabase.storage
        .from(this.storageBucket)
        .upload(storagePath, this.selectedFile, { upsert: false });

      clearInterval(progressInterval);
      progressInterval = null;

      if (storageError) {
        throw new Error(`Storage: ${storageError.message}`);
      }

      this.uploadProgress.set(85);
      this.uploadMessage.set('Registrando documento...');

      const payload = {
        title: this.docTitle.trim(),
        description: this.docDescription.trim() || undefined,
        categoryId: this.docCategoryId || undefined,
        storagePath,
        fileName: this.selectedFile.name,
        mimeType: this.selectedFile.type || undefined,
        fileSize: this.selectedFile.size,
        changeSummary: this.docChangeSummary.trim() || 'Version inicial',
      };

      await firstValueFrom(
        this.http.post(`${this.apiBase}/api/documents`, payload, {
          headers: this.authHeaders(true),
        }),
      );

      this.uploadProgress.set(100);
      this.uploadMessage.set('Documento subido correctamente.');
      this.resetUploadForm();
      await this.refreshData();
      this.openPanel('documents');
    } catch (error) {
      if (progressInterval) clearInterval(progressInterval);
      this.uploadProgress.set(0);
      this.uploadMessage.set(this.readError(error));
    }
  }

  async openDocumentPreview(document: DocumentItem): Promise<void> {
    if (!this.supabase) return;

    if (!document.current_storage_path) {
      this.documentsMessage.set('No hay archivo disponible para este documento.');
      return;
    }

    const previewWindow = this.openPreviewWindow();
    this.documentsMessage.set('Abriendo preview...');

    const { data, error } = await this.supabase.storage
      .from(this.storageBucket)
      .createSignedUrl(document.current_storage_path, 60 * 15);

    if (error || !data?.signedUrl) {
      previewWindow?.close();
      this.documentsMessage.set(
        error?.message || 'No se pudo generar la URL de preview del documento.',
      );
      return;
    }

    this.documentsMessage.set('');
    this.navigatePreviewWindow(previewWindow, data.signedUrl);
  }

  async openVersionPreview(version: DocumentVersionItem): Promise<void> {
    if (!this.supabase) return;

    const previewWindow = this.openPreviewWindow();
    this.documentsMessage.set('Abriendo version...');

    const { data, error } = await this.supabase.storage
      .from(this.storageBucket)
      .createSignedUrl(version.storage_path, 60 * 15);

    if (error || !data?.signedUrl) {
      previewWindow?.close();
      this.documentsMessage.set(error?.message || 'No se pudo generar la URL de la version.');
      return;
    }

    this.documentsMessage.set('');
    this.navigatePreviewWindow(previewWindow, data.signedUrl);
  }

  async openDocumentDetail(documentId: string, showPanel = true): Promise<void> {
    if (!this.activeOrganizationId()) {
      return;
    }

    this.isLoadingDocumentDetail.set(true);
    this.documentsMessage.set('');

    try {
      const detail = await firstValueFrom(
        this.http
          .get<DocumentDetail>(`${this.apiBase}/api/documents/${documentId}`, {
            headers: this.authHeaders(true),
          })
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      this.selectedDocument.set(detail);
      this.detailTitle = detail.title;
      this.detailDescription = detail.description ?? '';
      this.detailCategoryId = detail.category_id ?? '';
      this.approvalComments = '';
      this.versionChangeSummary = '';
      this.selectedVersionFile = null;
      if (showPanel) {
        this.activePanel.set('documents');
      }
    } catch (error) {
      this.documentsMessage.set(this.readError(error));
    } finally {
      this.isLoadingDocumentDetail.set(false);
    }
  }

  closeDocumentDetail(): void {
    this.resetDocumentDetail();
  }

  async saveDocumentDetail(): Promise<void> {
    const document = this.selectedDocument();
    if (!document) return;

    try {
      this.documentsMessage.set('Guardando documento...');
      await firstValueFrom(
        this.http
          .put(
            `${this.apiBase}/api/documents/${document.id}`,
            {
              title: this.detailTitle.trim(),
              description: this.detailDescription.trim() || undefined,
              categoryId: this.detailCategoryId || null,
            },
            { headers: this.authHeaders(true) },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      await this.refreshData();
      this.documentsMessage.set('Documento actualizado.');
    } catch (error) {
      this.documentsMessage.set(this.readError(error));
    }
  }

  async changeDocumentStatus(status: DocumentStatus): Promise<void> {
    const document = this.selectedDocument();
    if (!document) return;

    try {
      this.documentsMessage.set('Actualizando estado...');
      await firstValueFrom(
        this.http
          .patch(
            `${this.apiBase}/api/documents/${document.id}/status`,
            {
              status,
              comments: this.approvalComments.trim() || undefined,
            },
            { headers: this.authHeaders(true) },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      await this.refreshData();
      this.approvalComments = '';
      this.documentsMessage.set('Estado actualizado.');
    } catch (error) {
      this.documentsMessage.set(this.readError(error));
    }
  }

  onVersionFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedVersionFile = input.files?.[0] ?? null;
  }

  async uploadDocumentVersion(): Promise<void> {
    if (!this.supabase) return;
    const document = this.selectedDocument();
    const currentSession = this.session();
    const organizationId = this.activeOrganizationId();

    if (!document || !currentSession || !organizationId) {
      return;
    }

    if (!this.selectedVersionFile) {
      this.documentsMessage.set('Selecciona un archivo para la nueva version.');
      return;
    }

    try {
      this.documentsMessage.set('Subiendo nueva version...');
      const storagePath = this.buildStoragePath(
        organizationId,
        currentSession.user.id,
        this.selectedVersionFile.name,
      );

      const { error: storageError } = await this.supabase.storage
        .from(this.storageBucket)
        .upload(storagePath, this.selectedVersionFile, { upsert: false });

      if (storageError) {
        throw new Error(`Storage: ${storageError.message}`);
      }

      await firstValueFrom(
        this.http
          .post(
            `${this.apiBase}/api/documents/${document.id}/versions`,
            {
              storagePath,
              fileName: this.selectedVersionFile.name,
              mimeType: this.selectedVersionFile.type || undefined,
              fileSize: this.selectedVersionFile.size,
              changeSummary: this.versionChangeSummary.trim() || undefined,
            },
            { headers: this.authHeaders(true) },
          )
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      this.selectedVersionFile = null;
      this.versionChangeSummary = '';
      await this.refreshData();
      this.documentsMessage.set('Nueva version registrada.');
    } catch (error) {
      this.documentsMessage.set(this.readError(error));
    }
  }

  async deleteSelectedDocument(): Promise<void> {
    const document = this.selectedDocument();
    if (!document) return;

    const confirmed = window.confirm(`Eliminar documento "${document.title}". Esta accion no se puede deshacer.`);
    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(
        this.http
          .delete(`${this.apiBase}/api/documents/${document.id}`, {
            headers: this.authHeaders(true),
          })
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );
      this.resetDocumentDetail();
      await this.refreshData();
      this.documentsMessage.set('Documento eliminado.');
    } catch (error) {
      this.documentsMessage.set(this.readError(error));
    }
  }

  formatFileSize(size: number | null | undefined): string {
    if (!size) {
      return 'Sin tamano';
    }

    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} KB`;
    }

    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  auditActionLabel(item: AuditLogItem): string {
    const entity = item.entity_type.replaceAll('_', ' ');
    return `${item.action} - ${entity}`;
  }

  statusLabel(status: DocumentStatus): string {
    const labels: Record<DocumentStatus, string> = {
      draft: 'Borrador',
      in_review: 'Pendiente',
      approved: 'Aprobado',
      rejected: 'Rechazado',
      archived: 'Archivado',
    };
    return labels[status];
  }

  statusClass(status: DocumentStatus): string {
    return `status-${status}`;
  }

  categoryTone(index: number): string {
    const tones = ['tone-blue', 'tone-green', 'tone-purple', 'tone-orange'];
    return tones[index % tones.length];
  }

  documentAuthorLabel(document: DocumentItem): string {
    const value = document.created_by?.trim() ?? '';
    if (!value) {
      return 'Usuario';
    }

    return `ID ${value.slice(0, 6)}`;
  }

  userIdLabel(userId: string | null | undefined): string {
    const value = userId?.trim() ?? '';
    return value ? `ID ${value.slice(0, 6)}` : 'Usuario';
  }

  private async loadPublicConfig(): Promise<PublicConfig> {
    return firstValueFrom(
      this.http
        .get<PublicConfig>(`${this.apiBase}/api/config/public`)
        .pipe(timeout(App.HTTP_TIMEOUT_MS)),
    );
  }

  private async syncCurrentSession(): Promise<void> {
    if (!this.supabase) return;
    const { data, error } = await this.withTimeout(
      this.supabase.auth.getSession(),
      App.HTTP_TIMEOUT_MS,
      'Timeout al consultar la sesion',
    );
    if (error) {
      throw new Error(error.message);
    }
    this.session.set(data.session);
  }

  private async handleSessionChange(session: Session | null): Promise<void> {
    this.session.set(session);

    if (!session) {
      this.resetOrganizationContext();
      return;
    }

    await this.loadOrganizations();

    if (this.activeOrganizationId()) {
      await this.refreshData();
      return;
    }

    this.categories.set([]);
    this.documents.set([]);
  }

  private resetOrganizationContext(): void {
    this.organizations.set([]);
    this.members.set([]);
    this.activeOrganizationId.set('');
    this.organizationsMessage.set('');
    this.membersMessage.set('');
    this.documentCategoryFilter.set('');
    this.documentStatusFilter.set('');
    this.categories.set([]);
    this.documents.set([]);
    this.resetDocumentDetail();
    this.onboardingView.set('choice');
    this.newOrgName = '';
  }

  private async loadOrganizations(): Promise<void> {
    this.isLoadingOrgs.set(true);
    try {
      const response = await firstValueFrom(
        this.http
          .get<{ items: OrganizationItem[] }>(`${this.apiBase}/api/organizations`, {
            headers: this.authHeaders(),
          })
          .pipe(timeout(App.HTTP_TIMEOUT_MS)),
      );

      const items = [...(response.items ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
      );

      this.organizations.set(items);
      this.applyActiveOrganizationFromStorage(items);

      if (items.length === 0) {
        this.organizationsMessage.set('');
        return;
      }

      if (!this.activeOrganizationId()) {
        this.organizationsMessage.set('Selecciona una organizacion para ver tus datos.');
        return;
      }

      this.organizationsMessage.set('');
    } finally {
      this.isLoadingOrgs.set(false);
    }
  }

  private static readonly ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ]);

  private static readonly MAX_FILE_BYTES = 50 * 1024 * 1024;

  private validateFile(file: File): string | null {
    if (file.size > App.MAX_FILE_BYTES) {
      return `El archivo supera el limite de 50 MB (${this.formatFileSize(file.size)}).`;
    }
    if (file.type && !App.ALLOWED_MIME_TYPES.has(file.type)) {
      return 'Tipo de archivo no permitido. Se aceptan: PDF, Word, Excel, PowerPoint, texto, CSV e imagenes.';
    }
    return null;
  }

  private applyActiveOrganizationFromStorage(items: OrganizationItem[]): void {
    const session = this.session();
    const userId = session?.user.id;

    if (!userId) {
      this.activeOrganizationId.set('');
      return;
    }

    const stored =
      typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(this.organizationStorageKey(userId));
    const isStoredValid = !!stored && items.some((item) => item.id === stored);

    if (isStoredValid && stored) {
      this.activeOrganizationId.set(stored);
      return;
    }

    const currentActive = this.activeOrganizationId();
    const isCurrentValid = !!currentActive && items.some((item) => item.id === currentActive);
    if (isCurrentValid) {
      return;
    }

    const fallbackId = items[0]?.id ?? '';
    this.activeOrganizationId.set(fallbackId);
    this.persistActiveOrganizationId(fallbackId);
  }

  private persistActiveOrganizationId(organizationId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const session = this.session();
    const userId = session?.user.id;
    if (!userId) {
      return;
    }

    const key = this.organizationStorageKey(userId);

    if (!organizationId) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, organizationId);
  }

  private organizationStorageKey(userId: string): string {
    return `${App.ORG_STORAGE_KEY_PREFIX}${userId}`;
  }

  private authHeaders(requireOrganization = false): Record<string, string> {
    const userId = this.session()?.user.id;
    if (!userId) {
      throw new Error('No hay una sesion activa.');
    }

    const headers: Record<string, string> = {
      'x-user-id': userId,
    };

    if (requireOrganization) {
      const organizationId = this.activeOrganizationId();
      if (!organizationId) {
        throw new Error('Selecciona una organizacion para continuar.');
      }

      headers['x-organization-id'] = organizationId;
    }

    return headers;
  }

  private async fetchCategories(): Promise<CategoryItem[]> {
    const response = await firstValueFrom(
      this.http
        .get<{ items: CategoryItem[] }>(`${this.apiBase}/api/categories`, {
          headers: this.authHeaders(true),
        })
        .pipe(timeout(App.HTTP_TIMEOUT_MS)),
    );
    return response.items ?? [];
  }

  private async fetchDocuments(): Promise<DocumentItem[]> {
    const response = await firstValueFrom(
      this.http
        .get<{ items: DocumentItem[] }>(`${this.apiBase}/api/documents`, {
          headers: this.authHeaders(true),
        })
        .pipe(timeout(App.HTTP_TIMEOUT_MS)),
    );
    return response.items ?? [];
  }

  private buildStoragePath(organizationId: string, userId: string, fileName: string): string {
    const sanitized = fileName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    return `organizations/${organizationId}/${userId}/${Date.now()}-${sanitized}`;
  }

  private openPreviewWindow(): Window | null {
    const previewWindow = window.open('', '_blank');

    if (!previewWindow) {
      return null;
    }

    previewWindow.document.title = 'PaperHub Preview';
    previewWindow.document.body.style.margin = '0';
    previewWindow.document.body.style.fontFamily = 'Manrope, Segoe UI, sans-serif';
    previewWindow.document.body.style.background = '#edf3fb';
    previewWindow.document.body.style.color = '#10203a';
    previewWindow.document.body.innerHTML =
      '<div style="min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;">Abriendo preview...</div>';

    return previewWindow;
  }

  private navigatePreviewWindow(previewWindow: Window | null, signedUrl: string): void {
    if (previewWindow) {
      previewWindow.location.href = signedUrl;
      return;
    }

    window.location.href = signedUrl;
  }

  private resetUploadForm(): void {
    this.docTitle = '';
    this.docDescription = '';
    this.docCategoryId = '';
    this.docChangeSummary = 'Version inicial';
    this.selectedFile = null;
    this.uploadProgress.set(0);
  }

  private resetDocumentDetail(): void {
    this.selectedDocument.set(null);
    this.detailTitle = '';
    this.detailDescription = '';
    this.detailCategoryId = '';
    this.approvalComments = '';
    this.versionChangeSummary = '';
    this.selectedVersionFile = null;
  }

  private readError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return `No se pudo conectar con el backend (${this.apiBase}). Inicia la API con "npm run dev".`;
      }

      const apiMessage =
        typeof error.error === 'object' && error.error && 'error' in error.error
          ? String((error.error as { error: string }).error)
          : '';
      return apiMessage || `HTTP ${error.status}: ${error.message}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Error no controlado';
  }

  private mapAuthErrorMessage(message: string): string {
    const normalized = message.toLowerCase();

    if (normalized.includes('invalid login credentials')) {
      return 'Credenciales invalidas. Verifica correo/contrasena y confirma tu correo si acabas de crear la cuenta.';
    }

    if (normalized.includes('email not confirmed')) {
      return 'Tu correo aun no esta confirmado. Revisa la bandeja de entrada y vuelve a intentar.';
    }

    if (normalized.includes('user already registered')) {
      return 'Ese correo ya esta registrado. Inicia sesion o recupera tu contrasena.';
    }

    if (normalized.includes('same password')) {
      return 'La nueva contrasena no puede ser igual a la anterior.';
    }

    if (
      normalized.includes('failed to fetch') ||
      normalized.includes('networkerror') ||
      normalized.includes('load failed')
    ) {
      return 'No se pudo conectar con Supabase Auth. Verifica SUPABASE_URL/SUPABASE_ANON_KEY, DNS, VPN o firewall.';
    }

    return message;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);

      promise
        .then((value) => resolve(value))
        .catch((error: unknown) => reject(error))
        .finally(() => clearTimeout(timeoutId));
    });
  }
}
