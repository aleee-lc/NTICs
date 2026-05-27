import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { type OnboardingView } from '../app.models';

@Component({
  selector: 'app-onboarding-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './onboarding-page.component.html',
})
export class OnboardingPageComponent {
  @Input() onboardingView: OnboardingView = 'choice';
  @Input() currentUserInitials = '';
  @Input() currentUserName = '';
  @Input() userEmail = '';
  @Input() organizationsMessage = '';
  @Input() newOrgName = '';
  @Input() isCreatingFirstOrg = false;

  @Output() onboardingViewChange = new EventEmitter<OnboardingView>();
  @Output() logoutClick = new EventEmitter<void>();
  @Output() newOrgNameChange = new EventEmitter<string>();
  @Output() createOrganization = new EventEmitter<void>();
  @Output() refreshOrganizations = new EventEmitter<void>();
}
