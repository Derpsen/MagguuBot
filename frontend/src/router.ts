import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('./pages/Login.vue') },
  { path: '/', name: 'dashboard', component: () => import('./pages/Dashboard.vue') },
  { path: '/warnings', name: 'warnings', component: () => import('./pages/Warnings.vue') },
  { path: '/leaderboard', name: 'leaderboard', component: () => import('./pages/Leaderboard.vue') },
  { path: '/webhooks', name: 'webhooks', component: () => import('./pages/Webhooks.vue') },
  { path: '/channels', name: 'channels', component: () => import('./pages/Channels.vue') },
  { path: '/reminders', name: 'reminders', component: () => import('./pages/Reminders.vue') },
  { path: '/requests', name: 'requests', component: () => import('./pages/Requests.vue') },
  { path: '/role-panels', name: 'role-panels', component: () => import('./pages/RolePanels.vue') },
  { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue') },
  { path: '/tags', name: 'tags', component: () => import('./pages/Tags.vue') },
  { path: '/autoresponders', name: 'autoresponders', component: () => import('./pages/Autoresponders.vue') },
  { path: '/scheduled', name: 'scheduled', component: () => import('./pages/Scheduled.vue') },
  { path: '/tickets', name: 'tickets', component: () => import('./pages/Tickets.vue') },
  { path: '/reputation', name: 'reputation', component: () => import('./pages/Reputation.vue') },
  { path: '/rss', name: 'rss', component: () => import('./pages/RssFeeds.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
