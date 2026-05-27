import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { type AuthView } from '../app.models';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-page.component.html',
  styles: [':host { display: contents; }'],
})
export class AuthPageComponent {
  @Input() authView: AuthView = 'login';
  @Input() authMessage = '';
  @Input() loginEmail = '';
  @Input() loginPassword = '';
  @Input() registerName = '';
  @Input() registerEmail = '';
  @Input() registerPassword = '';
  @Input() registerConfirmPassword = '';

  @Output() authViewChange = new EventEmitter<AuthView>();
  @Output() loginEmailChange = new EventEmitter<string>();
  @Output() loginPasswordChange = new EventEmitter<string>();
  @Output() registerNameChange = new EventEmitter<string>();
  @Output() registerEmailChange = new EventEmitter<string>();
  @Output() registerPasswordChange = new EventEmitter<string>();
  @Output() registerConfirmPasswordChange = new EventEmitter<string>();
  @Output() loginSubmit = new EventEmitter<void>();
  @Output() registerSubmit = new EventEmitter<void>();
  @Output() passwordReset = new EventEmitter<void>();
}
