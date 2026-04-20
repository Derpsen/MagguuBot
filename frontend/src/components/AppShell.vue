<script setup lang="ts">
import { computed } from 'vue';
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
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-vue-next';
import type { SessionUser } from '../composables/useSession';
import { useSession } from '../composables/useSession';

const props = defineProps<{ user: SessionUser }>();
const route = useRoute();
const { logout } = useSession();

const nav = [
  { name: 'dashboard', label: 'Übersicht', icon: LayoutDashboard, to: '/' },
  { name: 'requests', label: 'Seerr Requests', icon: Inbox, to: '/requests' },
  { name: 'tickets', label: 'Tickets', icon: Ticket, to: '/tickets' },
  { name: 'warnings', label: 'Warnings', icon: ShieldAlert, to: '/warnings' },
  { name: 'tags', label: 'Tags', icon: TagIcon, to: '/tags' },
  { name: 'autoresponders', label: 'Autoresponders', icon: MessageSquare, to: '/autoresponders' },
  { name: 'scheduled', label: 'Scheduled', icon: Calendar, to: '/scheduled' },
  { name: 'leaderboard', label: 'XP-Leaderboard', icon: Trophy, to: '/leaderboard' },
  { name: 'reputation', label: 'Reputation', icon: Heart, to: '/reputation' },
  { name: 'reminders', label: 'Reminders', icon: Clock, to: '/reminders' },
  { name: 'role-panels', label: 'Role Panels', icon: Puzzle, to: '/role-panels' },
  { name: 'channels', label: 'Channels', icon: Hash, to: '/channels' },
  { name: 'webhooks', label: 'Webhooks', icon: Webhook, to: '/webhooks' },
  { name: 'settings', label: 'Settings', icon: SettingsIcon, to: '/settings' },
] as const;

const displayName = computed(() => props.user.globalName ?? props.user.username);
</script>

<template>
  <div class="flex h-full">
    <aside class="flex w-64 flex-col border-r border-border bg-slate-950/50 p-4">
      <div class="mb-8 flex items-center gap-3 px-2">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blurple text-white font-bold">
          M
        </div>
        <div>
          <div class="text-sm font-semibold text-white">MagguuBot</div>
          <div class="text-xs text-slate-500">Admin Dashboard</div>
        </div>
      </div>

      <nav class="flex flex-1 flex-col gap-1">
        <router-link
          v-for="item in nav"
          :key="item.name"
          :to="item.to"
          class="nav-link"
          :class="{ 'nav-link-active': route.name === item.name }"
        >
          <component :is="item.icon" class="h-4 w-4" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="mt-4 flex items-center gap-3 rounded-lg border border-border bg-slate-900/50 p-3">
        <img
          v-if="user.avatarUrl"
          :src="user.avatarUrl"
          class="h-9 w-9 rounded-full"
          alt=""
        />
        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-blurple text-sm font-semibold text-white" v-else>
          {{ displayName.slice(0, 1).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-slate-100">{{ displayName }}</div>
          <div class="text-xs text-slate-500">Admin</div>
        </div>
        <button class="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" @click="logout()" title="Logout">
          <LogOut class="h-4 w-4" />
        </button>
      </div>
    </aside>

    <main class="flex-1 overflow-y-auto p-8">
      <slot />
    </main>
  </div>
</template>
