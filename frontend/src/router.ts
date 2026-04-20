import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('./pages/Login.vue') },
  { path: '/', name: 'dashboard', component: () => import('./pages/Dashboard.vue') },
  { path: '/warnings', name: 'warnings', component: () => import('./pages/Warnings.vue') },
  { path: '/leaderboard', name: 'leaderboard', component: () => import('./pages/Leaderboard.vue') },
  { path: '/webhooks', name: 'webhooks', component: () => import('./pages/Webhooks.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
