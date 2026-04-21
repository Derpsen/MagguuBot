<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  LayoutDashboard,
  ShieldAlert,
  Trophy,
  Webhook,
  Hash,
  Clock,
  Inbox,
  Puzzle,
  Tag as TagIcon,
  MessageSquare,
  Calendar,
  Ticket,
  Heart,
  Rss,
  Settings as SettingsIcon,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  ExternalLink,
  type LucideIcon,
} from 'lucide-vue-next';
import type { SessionUser } from '../composables/useSession';
import { useSession } from '../composables/useSession';
import ToastStack from './ToastStack.vue';

const props = defineProps<{ user: SessionUser }>();
const route = useRoute();
const { logout } = useSession();

interface NavItem {
  name: string;
  label: string;
  icon: LucideIcon;
  to: string;
}
interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: 'Overview',
    items: [{ name: 'dashboard', label: 'Übersicht', icon: LayoutDashboard, to: '/' }],
  },
  {
    title: 'Moderation',
    items: [
      { name: 'requests', label: 'Seerr Requests', icon: Inbox, to: '/requests' },
      { name: 'tickets', label: 'Tickets', icon: Ticket, to: '/tickets' },
      { name: 'warnings', label: 'Warnings', icon: ShieldAlert, to: '/warnings' },
    ],
  },
  {
    title: 'Content',
    items: [
      { name: 'tags', label: 'Tags', icon: TagIcon, to: '/tags' },
      { name: 'autoresponders', label: 'Autoresponders', icon: MessageSquare, to: '/autoresponders' },
      { name: 'scheduled', label: 'Scheduled', icon: Calendar, to: '/scheduled' },
      { name: 'role-panels', label: 'Role Panels', icon: Puzzle, to: '/role-panels' },
    ],
  },
  {
    title: 'Community',
    items: [
      { name: 'leaderboard', label: 'XP', icon: Trophy, to: '/leaderboard' },
      { name: 'reputation', label: 'Reputation', icon: Heart, to: '/reputation' },
      { name: 'reminders', label: 'Reminders', icon: Clock, to: '/reminders' },
    ],
  },
  {
    title: 'Config',
    items: [
      { name: 'channels', label: 'Channels', icon: Hash, to: '/channels' },
      { name: 'webhooks', label: 'Webhooks', icon: Webhook, to: '/webhooks' },
      { name: 'rss', label: 'RSS Feeds', icon: Rss, to: '/rss' },
      { name: 'settings', label: 'Settings', icon: SettingsIcon, to: '/settings' },
    ],
  },
];

const displayName = computed(() => props.user.globalName ?? props.user.username);
const userInitial = computed(() => displayName.value.charAt(0).toUpperCase());

const collapsed = ref<boolean>(
  typeof window !== 'undefined' ? window.localStorage.getItem('mb-sidebar-collapsed') === '1' : false,
);
const mobileOpen = ref(false);

function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('mb-sidebar-collapsed', collapsed.value ? '1' : '0');
  }
}

const breadcrumb = computed(() => {
  for (const sec of sections) {
    const item = sec.items.find((i) => i.name === route.name);
    if (item) return { section: sec.title, label: item.label };
  }
  return { section: 'Dashboard', label: 'Übersicht' };
});

function isActive(item: NavItem): boolean {
  return route.name === item.name;
}
</script>

<template>
  <div class="relative flex h-full bg-surface-0 text-slate-100">
    <aside
      class="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface-1 transition-all duration-200"
      :class="[
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        collapsed ? 'w-16' : 'w-60',
      ]"
    >
      <div class="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-line px-4">
        <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blurple font-bold text-white">
          M
        </div>
        <div v-if="!collapsed" class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-white">MagguuBot</div>
          <div class="text-[11px] text-slate-500">Admin Dashboard</div>
        </div>
        <button
          class="btn-icon"
          :title="collapsed ? 'Sidebar expandieren' : 'Sidebar einklappen'"
          @click="toggleCollapse"
        >
          <component :is="collapsed ? ChevronsRight : ChevronsLeft" class="h-4 w-4" />
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">
        <div v-for="section in sections" :key="section.title">
          <div v-if="!collapsed" class="nav-section-label">
            {{ section.title }}
          </div>
          <div v-else class="mx-3 my-2 h-px bg-line" />

          <div class="space-y-0.5">
            <router-link
              v-for="item in section.items"
              :key="item.name"
              :to="item.to"
              class="nav-item"
              :class="[isActive(item) ? 'nav-item-active' : '', collapsed ? 'justify-center px-0' : '']"
              :title="collapsed ? item.label : undefined"
            >
              <component :is="item.icon" class="h-[18px] w-[18px] flex-shrink-0" />
              <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
            </router-link>
          </div>
        </div>
      </nav>

      <div class="flex-shrink-0 border-t border-line p-3">
        <div class="flex items-center gap-2" :class="collapsed ? 'flex-col' : ''">
          <div class="flex min-w-0 items-center gap-2" :class="collapsed ? '' : 'flex-1'">
            <img
              v-if="user.avatarUrl"
              :src="user.avatarUrl"
              :alt="displayName"
              class="h-8 w-8 flex-shrink-0 rounded-full"
            />
            <div
              v-else
              class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blurple text-xs font-semibold text-white"
            >
              {{ userInitial }}
            </div>
            <div v-if="!collapsed" class="min-w-0">
              <div class="truncate text-xs font-medium text-slate-100">{{ displayName }}</div>
              <div class="text-[10px] uppercase tracking-wider text-slate-500">Admin</div>
            </div>
          </div>
          <button class="btn-icon" title="Logout" @click="logout()">
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
      @click="mobileOpen = false"
    />

    <div
      class="flex min-h-screen flex-1 flex-col transition-all duration-200"
      :class="collapsed ? 'lg:pl-16' : 'lg:pl-60'"
    >
      <header class="sticky top-0 z-20 flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-line bg-surface-0/90 px-4 backdrop-blur">
        <button class="btn-icon lg:hidden" @click="mobileOpen = !mobileOpen">
          <Menu class="h-5 w-5" />
        </button>
        <nav class="flex min-w-0 items-center gap-1.5 text-sm">
          <router-link to="/" class="flex-shrink-0 text-blurple hover:opacity-80">
            <LayoutDashboard class="h-4 w-4" />
          </router-link>
          <span class="flex-shrink-0 text-slate-600">/</span>
          <span class="flex-shrink-0 text-slate-500">{{ breadcrumb.section }}</span>
          <span class="flex-shrink-0 text-slate-600">/</span>
          <span class="truncate font-medium text-white">{{ breadcrumb.label }}</span>
        </nav>

        <div class="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/Derpsen/MagguuBot"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-icon"
            title="Repository"
          >
            <ExternalLink class="h-4 w-4" />
          </a>
        </div>
      </header>

      <main class="flex-1 overflow-x-hidden p-6 lg:p-8">
        <div :key="route.fullPath" class="page-fade mx-auto max-w-[1400px]">
          <slot />
        </div>
      </main>
    </div>

    <ToastStack />
  </div>
</template>
