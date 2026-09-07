import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'practice',
    loadComponent: () =>
      import('./features/practice/practice.component').then((m) => m.PracticeComponent),
  },
  {
    path: 'playbook',
    loadComponent: () =>
      import('./features/playbook/playbook.component').then((m) => m.PlaybookComponent),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
