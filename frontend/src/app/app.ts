import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../environments/environment';

type PanelId = 'overview' | 'documents' | 'upload' | 'categories';
type AuthView = 'login' | 'register';
type DocumentStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'archived';

interface PublicConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  storageBucket: string | null;
}

interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_at: string;
  joined_at?: string;
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
  readonly activeOrganizationId = signal('');
  readonly organizationsMessage = signal('');
  readonly categories = signal<CategoryItem[]>([]);
  readonly documents = signal<DocumentItem[]>([]);
  readonly searchTerm = signal('');
  readonly documentCategoryFilter = signal('');
  readonly isCategoryFormOpen = signal(false);
  readonly editingCategoryId = signal<string | null>(null);
  readonly isSavingCategory = signal(false);
  readonly isCreatingOrganization = signal(false);
  readonly isUserMenuOpen = signal(false);
  readonly isSidebarCollapsed = signal(false);
  readonly apiBase = environment.apiBaseUrl;

  readonly activeOrganization = computed(() =>
    this.organizations().find((organization) => organization.id === this.activeOrganizationId()) ?? null,
  );

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
    const term = this.searchTerm().trim().toLowerCase();

    return this.documents()
      .filter((document) => !categoryFilter || document.category_id === categoryFilter)
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
    this.isUserMenuOpen.set(false);
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
  }

  onOrganizationChange(event: Event): void {
    const input = event.target as HTMLSelectElement;
    const organizationId = input.value;

    this.activeOrganizationId.set(organizationId);
    this.persistActiveOrganizationId(organizationId);
    this.cancelCategoryForm();
    this.documentCategoryFilter.set('');
    this.resetUploadForm();
    this.documentsMessage.set('');
    this.uploadMessage.set('');
    this.categoryMessage.set('');

    if (!organizationId) {
      this.categories.set([]);
      this.documents.set([]);
      this.organizationsMessage.set('Selecciona una organizacion para continuar.');
      return;
    }

    this.organizationsMessage.set('');
    void this.refreshData();
  }

  async promptCreateOrganization(): Promise<void> {
    if (this.isCreatingOrganization()) {
      return;
    }

    const input = window.prompt('Nombre de la nueva organizacion');
    const name = input?.trim() ?? '';

    if (!name) {
      return;
    }

    if (name.length < 2) {
      this.organizationsMessage.set('El nombre de la organizacion debe tener al menos 2 caracteres.');
      return;
    }

    this.isCreatingOrganization.set(true);
    this.organizationsMessage.set('Creando organizacion...');

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
      this.organizationsMessage.set(`Organizacion "${created.name}" creada.`);

      await this.refreshData();
    } catch (error) {
      this.organizationsMessage.set(this.readError(error));
    } finally {
      this.isCreatingOrganization.set(false);
    }
  }

  organizationRoleLabel(role: OrganizationItem['role']): string {
    const labels: Record<OrganizationItem['role'], string> = {
      owner: 'Owner',
      admin: 'Admin',
      member: 'Member',
      viewer: 'Viewer',
    };

    return labels[role];
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
    await this.supabase.auth.signOut();
  }

  toggleUserMenu(): void {
    this.isUserMenuOpen.update((value) => !value);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isUserMenuOpen()) {
      return;
    }

    const target = event.target as Node | null;
    if (!target) {
      this.isUserMenuOpen.set(false);
      return;
    }

    const hostElement = this.elementRef.nativeElement;
    const menuContainer = hostElement.querySelector('.user-menu');

    if (!menuContainer?.contains(target)) {
      this.isUserMenuOpen.set(false);
    }
  }

  async refreshData(): Promise<void> {
    if (!this.session()) return;

    if (!this.activeOrganizationId()) {
      this.categories.set([]);
      this.documents.set([]);
      this.documentCategoryFilter.set('');
      this.uploadMessage.set('Selecciona una organizacion para subir documentos.');
      this.documentsMessage.set('Selecciona una organizacion para cargar documentos.');
      this.categoryMessage.set('Selecciona una organizacion para administrar categorias.');
      return;
    }

    try {
      const [categories, documents] = await Promise.all([this.fetchCategories(), this.fetchDocuments()]);
      this.categories.set(categories);
      this.documents.set(documents);
      this.uploadMessage.set('');
      this.documentsMessage.set('');
    } catch (error) {
      this.uploadMessage.set(this.readError(error));
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

    try {
      this.uploadMessage.set('Subiendo archivo a Supabase Storage...');
      const storagePath = this.buildStoragePath(
        organizationId,
        currentSession.user.id,
        this.selectedFile.name,
      );

      const { error: storageError } = await this.supabase.storage
        .from(this.storageBucket)
        .upload(storagePath, this.selectedFile, { upsert: false });

      if (storageError) {
        throw new Error(`Storage: ${storageError.message}`);
      }

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
      this.uploadMessage.set('Documento subido y registrado correctamente.');
      this.resetUploadForm();
      await this.refreshData();
      this.openPanel('documents');
    } catch (error) {
      this.uploadMessage.set(this.readError(error));
    }
  }

  async openDocumentPreview(document: DocumentItem): Promise<void> {
    if (!this.supabase) return;

    if (!document.current_storage_path) {
      this.documentsMessage.set('No hay archivo disponible para este documento.');
      return;
    }

    const { data, error } = await this.supabase.storage
      .from(this.storageBucket)
      .createSignedUrl(document.current_storage_path, 60 * 15);

    if (error || !data?.signedUrl) {
      this.documentsMessage.set(
        error?.message || 'No se pudo generar la URL de preview del documento.',
      );
      return;
    }

    this.documentsMessage.set('');
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
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
    this.activeOrganizationId.set('');
    this.organizationsMessage.set('');
    this.documentCategoryFilter.set('');
    this.categories.set([]);
    this.documents.set([]);
  }

  private async loadOrganizations(): Promise<void> {
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
      this.organizationsMessage.set(
        'No tienes organizaciones activas. Crea una para comenzar.',
      );
      return;
    }

    if (!this.activeOrganizationId()) {
      this.organizationsMessage.set('Selecciona una organizacion para ver tus datos.');
      return;
    }

    this.organizationsMessage.set('');
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

  private resetUploadForm(): void {
    this.docTitle = '';
    this.docDescription = '';
    this.docCategoryId = '';
    this.docChangeSummary = 'Version inicial';
    this.selectedFile = null;
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
