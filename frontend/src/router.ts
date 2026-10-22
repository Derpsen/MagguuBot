import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSession } from './composables/useSession';
import { LEGACY_REDIRECTS } from './lib/navigation';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('./pages/Login.vue') },
  { path: '/', name: 'dashboard', component: () => import('./pages/Dashboard.vue') },
  { path: '/requests', name: 'requests', component: () => import('./pages/Requests.vue') },
  { path: '/webhooks', name: 'webhooks', component: () => import('./pages/Webhooks.vue') },
  { path: '/moderation', name: 'moderation', component: () => import('./pages/Moderation.vue') },
  { path: '/content', name: 'content', component: () => import('./pages/Content.vue') },
  { path: '/members', name: 'members', component: () => import('./pages/Members.vue') },
  { path: '/channels', name: 'channels', component: () => import('./pages/ChannelsHub.vue') },
  { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue') },
  ...LEGACY_REDIRECTS.map(({ from, hub, tab }): RouteRecordRaw => ({
    path: from,
    redirect: (to) => ({ path: `/${hub}`, query: { ...to.query, tab } }),
  })),
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const session = useSession();

  if (!session.loaded.value) {
    await session.refresh();
  }

  if (to.name === 'login') {
    if (session.user.value) {
      const next = typeof to.query.next === 'string' ? to.query.next : '/';
      return next.startsWith('/') && !next.startsWith('//') ? next : '/';
    }
    return true;
  }

  if (!session.user.value) {
    return { name: 'login', query: { next: to.fullPath } };
  }

  return true;
});
