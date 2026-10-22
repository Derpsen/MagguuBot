<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  LayoutDashboard,
  Inbox,
  Webhook,
  ShieldAlert,
  FileText,
  Users,
  Hash,
  Settings as SettingsIcon,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  ExternalLink,
  type LucideIcon,
} from '@lucide/vue';
import type { SessionUser } from '../composables/useSession';
import { useSession } from '../composables/useSession';
import { NAV_SECTIONS, type NavEntry, type NavIconKey } from '../lib/navigation';
import ToastStack from './ToastStack.vue';
import GlobalSearch from './GlobalSearch.vue';

const props = defineProps<{ user: SessionUser }>();
const route = useRoute();
const { logout } = useSession();

const ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  requests: Inbox,
  webhooks: Webhook,
  moderation: ShieldAlert,
  content: FileText,
  members: Users,
  channels: Hash,
  settings: SettingsIcon,
};

const sections = NAV_SECTIONS;

const displayName = computed(() => props.user.globalName ?? props.user.username);
const userInitial = computed(() => displayName.value.charAt(0).toUpperCase());

const collapsed = ref<boolean>(
  typeof window !== 'undefined' ? window.localStorage.getItem('mb-sidebar-collapsed') === '1' : false,
);
const mobileOpen = ref(false);
const openSections = reactive<Record<string, boolean>>(
  Object.fromEntries(sections.map((section) => [section.title, true])),
);

function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('mb-sidebar-collapsed', collapsed.value ? '1' : '0');
  }
}

function toggleSection(title: string): void {
  openSections[title] = !openSections[title];
}

const activeItem = computed<NavEntry | null>(() => {
  for (const section of sections) {
    const item = section.items.find((entry) => entry.name === route.name);
    if (item) return item;
  }
  return sections[0]?.items[0] ?? null;
});

const pageHeading = computed(() => activeItem.value?.label ?? 'Übersicht');

function isActive(item: NavEntry): boolean {
  return route.name === item.name;
}

const expanded = computed(() => !collapsed.value || mobileOpen.value);
</script>

<template>
  <div class="relative flex min-h-full bg-surface-0 text-silver-200">
    <a
      href="#main-content"
      class="fixed left-4 top-3 z-[100] -translate-y-20 rounded-md bg-brand-400 px-4 py-2 text-sm font-semibold text-ink transition-transform focus:translate-y-0"
    >
      Zum Inhalt springen
    </a>

    <aside
      class="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-surface-0 transition-all duration-200"
      :class="[
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        expanded ? 'w-48' : 'w-14',
      ]"
    >
      <div class="flex h-[50px] shrink-0 items-center gap-2.5 px-3">
        <router-link to="/" class="flex min-w-0 items-center gap-2.5">
          <img src="/favicon-32.png" alt="MagguuUI" width="28" height="28" class="h-7 w-7 shrink-0" />
          <span v-if="expanded" class="truncate text-sm font-semibold text-white">MagguuBot</span>
        </router-link>
        <button
          v-if="expanded"
          class="ml-auto hidden rounded-sm p-1 text-silver-300 transition-colors hover:bg-white/5 hover:text-white lg:inline-flex"
          title="Sidebar einklappen"
          aria-label="Sidebar einklappen"
          @click="toggleCollapse"
        >
          <ChevronsLeft class="h-4 w-4" />
        </button>
      </div>
      <button
        v-if="!expanded"
        class="mx-auto mb-1 hidden rounded-sm p-1 text-silver-300 transition-colors hover:bg-white/5 hover:text-white lg:inline-flex"
        title="Sidebar ausklappen"
        aria-label="Sidebar ausklappen"
        @click="toggleCollapse"
      >
        <ChevronsRight class="h-4 w-4" />
      </button>

      <nav class="flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1.5" aria-label="Hauptnavigation">
        <div v-for="section in sections" :key="section.title" class="mt-2 first:mt-0">
          <div v-if="!expanded" class="mx-3 my-2 h-px bg-white/10" />
          <button
            v-else
            type="button"
            class="flex w-full items-center justify-between px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-300 transition-colors hover:text-brand-200"
            :aria-expanded="openSections[section.title]"
            @click="toggleSection(section.title)"
          >
            {{ section.title }}
          </button>

          <div v-show="!expanded || openSections[section.title]" class="space-y-0.5">
            <router-link
              v-for="item in section.items"
              :key="item.name"
              :to="item.to"
              class="nav-item"
              :class="[isActive(item) ? 'nav-item-active' : '', expanded ? '' : 'justify-center px-0']"
              :title="expanded ? undefined : item.label"
              :aria-current="isActive(item) ? 'page' : undefined"
              @click="mobileOpen = false"
            >
              <component :is="ICONS[item.icon]" class="h-[18px] w-[18px] shrink-0" />
              <span v-if="expanded" class="truncate">{{ item.label }}</span>
            </router-link>
          </div>
        </div>
      </nav>

      <div class="shrink-0 border-t border-line p-2">
        <div class="flex items-center gap-2" :class="expanded ? '' : 'flex-col'">
          <img
            v-if="user.avatarUrl"
            :src="user.avatarUrl"
            :alt="displayName"
            class="h-7 w-7 shrink-0 rounded-full object-cover"
          />
          <div
            v-else
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs font-semibold text-white"
          >
            {{ userInitial }}
          </div>
          <div v-if="expanded" class="min-w-0 flex-1">
            <div class="truncate text-xs font-semibold text-silver-200">{{ displayName }}</div>
            <div class="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">Admin</div>
          </div>
          <button class="btn-icon" title="Abmelden" aria-label="Abmelden" @click="logout()">
            <LogOut class="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>

    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/60 lg:hidden"
      @click="mobileOpen = false"
    />

    <div
      class="flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-200"
      :class="collapsed ? 'lg:pl-14' : 'lg:pl-48'"
    >
      <header class="sticky top-0 z-20 flex h-[50px] shrink-0 items-center gap-3 border-b border-line bg-surface-0 px-4 sm:px-6">
        <button class="btn-icon lg:hidden" aria-label="Navigation öffnen" @click="mobileOpen = !mobileOpen">
          <Menu class="h-5 w-5" />
        </button>
        <span class="truncate text-sm font-semibold text-white">{{ pageHeading }}</span>

        <GlobalSearch />
        <a
          href="https://github.com/Derpsen/MagguuBot"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-icon"
          title="Repository"
          aria-label="Repository"
        >
          <ExternalLink class="h-4 w-4" />
        </a>
      </header>

      <main id="main-content" class="app-content min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
        <div :key="route.path" class="page-fade mx-auto w-full min-w-0 max-w-[1280px]">
          <slot />
        </div>
      </main>
    </div>

    <ToastStack />
  </div>
</template>
