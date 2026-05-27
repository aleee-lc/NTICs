import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  type AuditLogItem,
  type CategoryItem,
  type DocumentDetail,
  type DocumentItem,
  type DocumentStatus,
  type DocumentVersionItem,
  type OrganizationItem,
  type OrganizationMember,
  type OrganizationRole,
  type PanelId,
} from '../app.models';

@Component({
  selector: 'app-workspace-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './workspace-page.component.html',
})
export class WorkspacePageComponent {
  @Input() activePanel: PanelId = 'overview';
  @Input() isSidebarCollapsed = false;
  @Input() searchTerm = '';
  @Input() activeOrganizationId = '';
  @Input() organizations: OrganizationItem[] = [];
  @Input() isOrgCreateDropdownOpen = false;
  @Input() isCreatingOrganization = false;
  @Input() organizationsMessage = '';
  @Input() workspaceNewOrgName = '';
  @Input() currentUserInitials = '';
  @Input() currentUserName = '';
  @Input() userEmail = '';
  @Input() currentOrganizationRole: OrganizationRole | null = null;
  @Input() isUserMenuOpen = false;
  @Input() totalDocuments = 0;
  @Input() inReviewDocuments = 0;
  @Input() approvedDocuments = 0;
  @Input() recentDocuments: DocumentItem[] = [];
  @Input() documentCategoryFilter = '';
  @Input() documentStatusFilter = '';
  @Input() categories: CategoryItem[] = [];
  @Input() visibleDocuments: DocumentItem[] = [];
  @Input() isLoadingDocumentDetail = false;
  @Input() selectedDocument: DocumentDetail | null = null;
  @Input() detailTitle = '';
  @Input() detailCategoryId = '';
  @Input() detailDescription = '';
  @Input() approvalComments = '';
  @Input() versionChangeSummary = '';
  @Input() documentsMessage = '';
  @Input() docTitle = '';
  @Input() docCategoryId = '';
  @Input() docDescription = '';
  @Input() docChangeSummary = '';
  @Input() uploadProgress = 0;
  @Input() uploadMessage = '';
  @Input() isCategoryFormOpen = false;
  @Input() editingCategoryId: string | null = null;
  @Input() isSavingCategory = false;
  @Input() categoryName = '';
  @Input() categoryDescription = '';
  @Input() filteredCategories: CategoryItem[] = [];
  @Input() categoryMessage = '';
  @Input() members: OrganizationMember[] = [];
  @Input() inviteEmail = '';
  @Input() inviteRole: OrganizationRole = 'viewer';
  @Input() membersMessage = '';
  @Input() canManageMembers = false;
  @Input() canApproveDocuments = false;
  @Input() canWriteDocuments = false;

  @Input() organizationRoleLabel: (role: OrganizationRole) => string = (role) => role;
  @Input() documentAuthorLabel: (document: DocumentItem) => string = () => '';
  @Input() statusClass: (status: DocumentStatus) => string = () => '';
  @Input() statusLabel: (status: DocumentStatus) => string = (status) => status;
  @Input() formatFileSize: (size: number | null | undefined) => string = () => '';
  @Input() userIdLabel: (userId: string | null | undefined) => string = () => '';
  @Input() memberDisplayName: (member: OrganizationMember) => string = () => '';
  @Input() categoryTone: (index: number) => string = () => '';
  @Input() auditActionLabel: (item: AuditLogItem) => string = () => '';

  @Output() panelChange = new EventEmitter<PanelId>();
  @Output() searchTermChange = new EventEmitter<string>();
  @Output() organizationChange = new EventEmitter<string>();
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() refreshData = new EventEmitter<void>();
  @Output() toggleOrgCreateDropdown = new EventEmitter<void>();
  @Output() workspaceNewOrgNameChange = new EventEmitter<string>();
  @Output() createOrganization = new EventEmitter<void>();
  @Output() toggleUserMenu = new EventEmitter<void>();
  @Output() logoutClick = new EventEmitter<void>();
  @Output() openDocumentPreview = new EventEmitter<DocumentItem>();
  @Output() documentCategoryFilterChange = new EventEmitter<string>();
  @Output() documentStatusFilterChange = new EventEmitter<string>();
  @Output() clearDocumentFilters = new EventEmitter<void>();
  @Output() openDocumentDetail = new EventEmitter<string>();
  @Output() closeDocumentDetail = new EventEmitter<void>();
  @Output() detailTitleChange = new EventEmitter<string>();
  @Output() detailCategoryIdChange = new EventEmitter<string>();
  @Output() detailDescriptionChange = new EventEmitter<string>();
  @Output() saveDocumentDetail = new EventEmitter<void>();
  @Output() changeDocumentStatus = new EventEmitter<DocumentStatus>();
  @Output() approvalCommentsChange = new EventEmitter<string>();
  @Output() versionFileSelected = new EventEmitter<Event>();
  @Output() versionChangeSummaryChange = new EventEmitter<string>();
  @Output() uploadDocumentVersion = new EventEmitter<void>();
  @Output() openVersionPreview = new EventEmitter<DocumentVersionItem>();
  @Output() deleteSelectedDocument = new EventEmitter<void>();
  @Output() docTitleChange = new EventEmitter<string>();
  @Output() docCategoryIdChange = new EventEmitter<string>();
  @Output() docDescriptionChange = new EventEmitter<string>();
  @Output() docChangeSummaryChange = new EventEmitter<string>();
  @Output() fileSelected = new EventEmitter<Event>();
  @Output() uploadDocument = new EventEmitter<void>();
  @Output() openCreateCategoryForm = new EventEmitter<void>();
  @Output() saveCategory = new EventEmitter<void>();
  @Output() categoryNameChange = new EventEmitter<string>();
  @Output() categoryDescriptionChange = new EventEmitter<string>();
  @Output() cancelCategoryForm = new EventEmitter<void>();
  @Output() startEditCategory = new EventEmitter<CategoryItem>();
  @Output() deleteCategory = new EventEmitter<CategoryItem>();
  @Output() viewCategoryDocuments = new EventEmitter<string>();
  @Output() inviteEmailChange = new EventEmitter<string>();
  @Output() inviteRoleChange = new EventEmitter<OrganizationRole>();
  @Output() inviteMember = new EventEmitter<void>();
  @Output() updateMemberRole = new EventEmitter<{ member: OrganizationMember; role: OrganizationRole }>();
  @Output() removeMember = new EventEmitter<OrganizationMember>();
}
