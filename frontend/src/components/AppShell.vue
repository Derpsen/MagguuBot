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
  Palette,
  Bot,
  type LucideIcon,
} from '@lucide/vue';
import type { SessionUser } from '../composables/useSession';
import { useSession } from '../composables/useSession';
import ToastStack from './ToastStack.vue';
import GlobalSearch from './GlobalSearch.vue';

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
    title: 'Übersicht',
    items: [{ name: 'dashboard', label: 'Übersicht', icon: LayoutDashboard, to: '/' }],
  },
  {
    title: 'Moderation',
    items: [
      { name: 'requests', label: 'Seerr-Anfragen', icon: Inbox, to: '/requests' },
      { name: 'tickets', label: 'Tickets', icon: Ticket, to: '/tickets' },
      { name: 'warnings', label: 'Verwarnungen', icon: ShieldAlert, to: '/warnings' },
    ],
  },
  {
    title: 'Inhalte',
    items: [
      { name: 'tags', label: 'Tags', icon: TagIcon, to: '/tags' },
      { name: 'autoresponders', label: 'Auto-Antworten', icon: MessageSquare, to: '/autoresponders' },
      { name: 'scheduled', label: 'Geplante Beiträge', icon: Calendar, to: '/scheduled' },
      { name: 'role-panels', label: 'Rollen-Panels', icon: Puzzle, to: '/role-panels' },
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
    title: 'Konfiguration',
    items: [
      { name: 'channels', label: 'Kanäle', icon: Hash, to: '/channels' },
      { name: 'webhooks', label: 'Webhooks', icon: Webhook, to: '/webhooks' },
      { name: 'rss', label: 'RSS-Feeds', icon: Rss, to: '/rss' },
      { name: 'settings', label: 'Einstellungen', icon: SettingsIcon, to: '/settings' },
    ],
  },
];

const displayName = computed(() => props.user.globalName ?? props.user.username);
const userInitial = computed(() => displayName.value.charAt(0).toUpperCase());

const collapsed = ref<boolean>(
  typeof window !== 'undefined' ? window.localStorage.getItem('mb-sidebar-collapsed') === '1' : false,
);
const mobileOpen = ref(false);
type Theme = 'dark' | 'amoled' | 'aurora';
const storedTheme = typeof window !== 'undefined' ? window.localStorage.getItem('mb-theme') : null;
const theme = ref<Theme>(storedTheme === 'amoled' || storedTheme === 'aurora' ? storedTheme : 'dark');
const themeLabel = computed(() => theme.value === 'dark' ? 'Dark' : theme.value === 'amoled' ? 'AMOLED' : 'Aurora');

function cycleTheme(): void {
  theme.value = theme.value === 'dark' ? 'amoled' : theme.value === 'amoled' ? 'aurora' : 'dark';
  window.localStorage.setItem('mb-theme', theme.value);
}

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

const activeItem = computed(() => {
  for (const section of sections) {
    const item = section.items.find((entry) => entry.name === route.name);
    if (item) return item;
  }
  return sections[0]?.items[0] ?? null;
});

function isActive(item: NavItem): boolean {
  return route.name === item.name;
}
</script>

<template>
  <div class="relative flex min-h-full bg-surface-0 text-slate-100" :class="`theme-${theme}`">
    <a
      href="#main-content"
      class="fixed left-4 top-3 z-[100] -translate-y-20 rounded-xl bg-blurple px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
    >
      Zum Inhalt springen
    </a>

    <aside
      class="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface-1/95 shadow-[12px_0_45px_rgba(0,0,0,0.14)] backdrop-blur-xl transition-all duration-300"
      :class="[
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        mobileOpen ? 'w-[272px]' : collapsed ? 'w-[76px]' : 'w-[272px]',
      ]"
    >
      <div class="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
        <div class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blurple via-violet-500 to-cyan-400 text-white shadow-[0_10px_30px_rgba(124,109,242,0.30)]">
          <Bot class="h-5 w-5" />
          <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-1 bg-emerald-400" />
        </div>
        <div v-if="!collapsed || mobileOpen" class="min-w-0 flex-1">
          <div class="truncate text-sm font-bold tracking-tight text-white">MagguuBot</div>
          <div class="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-emerald-400">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Dashboard online
          </div>
        </div>
        <button
          class="btn-icon hidden lg:inline-flex"
          :title="collapsed ? 'Sidebar expandieren' : 'Sidebar einklappen'"
          :aria-label="collapsed ? 'Sidebar expandieren' : 'Sidebar einklappen'"
          @click="toggleCollapse"
        >
          <component :is="collapsed ? ChevronsRight : ChevronsLeft" class="h-4 w-4" />
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2">
        <div v-for="section in sections" :key="section.title">
          <div v-if="!collapsed || mobileOpen" class="nav-section-label">
            {{ section.title }}
          </div>
          <div v-else class="mx-3 my-2 h-px bg-line" />

          <div class="space-y-0.5">
            <router-link
              v-for="item in section.items"
              :key="item.name"
              :to="item.to"
              class="nav-item"
              :class="[isActive(item) ? 'nav-item-active' : '', collapsed && !mobileOpen ? 'justify-center px-0' : '']"
              :title="collapsed && !mobileOpen ? item.label : undefined"
              @click="mobileOpen = false"
            >
              <component :is="item.icon" class="h-[18px] w-[18px] shrink-0" />
              <span v-if="!collapsed || mobileOpen" class="truncate">{{ item.label }}</span>
            </router-link>
          </div>
        </div>
      </nav>

      <div class="shrink-0 border-t border-line p-2.5">
        <div
          class="flex items-center gap-2 rounded-2xl border border-transparent p-1.5"
          :class="collapsed && !mobileOpen ? 'flex-col' : 'bg-surface-2/55 border-line'"
        >
          <div class="flex min-w-0 items-center gap-2" :class="collapsed && !mobileOpen ? '' : 'flex-1'">
            <img
              v-if="user.avatarUrl"
              :src="user.avatarUrl"
              :alt="displayName"
              class="h-9 w-9 shrink-0 rounded-xl object-cover"
            />
            <div
              v-else
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blurple text-xs font-semibold text-white"
            >
              {{ userInitial }}
            </div>
            <div v-if="!collapsed || mobileOpen" class="min-w-0">
              <div class="truncate text-xs font-semibold text-slate-100">{{ displayName }}</div>
              <div class="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">Administrator</div>
            </div>
          </div>
          <button class="btn-icon" title="Abmelden" aria-label="Abmelden" @click="logout()">
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
      @click="mobileOpen = false"
    />

    <div
      class="flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-200"
      :class="collapsed ? 'lg:pl-[76px]' : 'lg:pl-[272px]'"
    >
      <header class="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface-0/78 px-4 backdrop-blur-xl sm:px-6">
        <button class="btn-icon lg:hidden" aria-label="Navigation öffnen" @click="mobileOpen = !mobileOpen">
          <Menu class="h-5 w-5" />
        </button>
        <nav class="flex min-w-0 items-center gap-2 text-sm" aria-label="Brotkrumen-Navigation">
          <router-link to="/" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-1 text-violet-300 transition hover:border-blurple/30 hover:bg-blurple-soft">
            <component :is="activeItem?.icon ?? LayoutDashboard" class="h-4 w-4" />
          </router-link>
          <span class="hidden shrink-0 text-slate-700 sm:inline">/</span>
          <span class="hidden shrink-0 text-xs font-medium text-slate-500 sm:inline">{{ breadcrumb.section }}</span>
          <span class="hidden shrink-0 text-slate-700 sm:inline">/</span>
          <span class="truncate font-medium text-white">{{ breadcrumb.label }}</span>
        </nav>

        <GlobalSearch />
        <div class="flex items-center gap-1">
          <button
            class="flex h-9 items-center gap-2 rounded-xl px-2.5 text-slate-400 transition hover:bg-surface-2 hover:text-white"
            :title="`Theme wechseln: ${themeLabel}`"
            :aria-label="`Theme wechseln. Aktuell ${themeLabel}`"
            @click="cycleTheme"
          >
            <Palette class="h-4 w-4" />
            <span class="hidden text-xs font-semibold xl:inline">{{ themeLabel }}</span>
          </button>
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

      <main id="main-content" class="app-content min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
        <div :key="route.fullPath" class="page-fade mx-auto min-w-0 w-full max-w-[1480px]">
          <slot />
        </div>
      </main>
    </div>

    <ToastStack />
  </div>
</template>
