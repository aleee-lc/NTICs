import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import { type AuthView } from '../app.models';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './landing-page.component.html',
  styles: [':host { display: contents; }'],
})
export class LandingPageComponent {
  @Output() authNavigate = new EventEmitter<AuthView>();
}
