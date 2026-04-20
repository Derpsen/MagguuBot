<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Clock, ShieldAlert, Trophy, Webhook, Inbox, Star } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Stats {
  uptimeSeconds: number;
  warningsCount: number;
  webhooksLast24h: number;
  topUser: { username: string; xp: number; level: number } | null;
  recentActions: Array<{ id: number; action: string; moderator: string; target: string; createdAt: string }>;
  remindersCount: number;
  pendingSeerrCount: number;
  starboardCount: number;
}

const stats = ref<Stats | null>(null);
const loading = ref(true);

onMounted(async () => {
  stats.value = await api<Stats>('/api/admin/stats');
  loading.value = false;
});

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Übersicht</h1>
    <p class="mt-1 text-sm text-slate-400">Live-Status deines Bots und der letzten Aktivität.</p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else-if="stats" class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div class="stat-card">
        <div class="flex items-center gap-2 text-slate-400">
          <Clock class="h-4 w-4" />
          <span class="stat-label">Uptime</span>
        </div>
        <div class="stat-number">{{ formatUptime(stats.uptimeSeconds) }}</div>
      </div>
      <div class="stat-card">
        <div class="flex items-center gap-2 text-slate-400">
          <Webhook class="h-4 w-4" />
          <span class="stat-label">Webhooks 24h</span>
        </div>
        <div class="stat-number">{{ stats.webhooksLast24h }}</div>
      </div>
      <router-link to="/warnings" class="stat-card cursor-pointer transition-colors hover:border-blurple">
        <div class="flex items-center gap-2 text-slate-400">
          <ShieldAlert class="h-4 w-4" />
          <span class="stat-label">Warnings</span>
        </div>
        <div class="stat-number">{{ stats.warningsCount }}</div>
      </router-link>
      <router-link to="/leaderboard" class="stat-card cursor-pointer transition-colors hover:border-blurple">
        <div class="flex items-center gap-2 text-slate-400">
          <Trophy class="h-4 w-4" />
          <span class="stat-label">Top User</span>
        </div>
        <div v-if="stats.topUser" class="stat-number">
          {{ stats.topUser.username }}
          <span class="ml-1 text-sm font-normal text-slate-500">Lv {{ stats.topUser.level }}</span>
        </div>
        <div v-else class="stat-number text-slate-600">—</div>
      </router-link>
      <router-link to="/requests" class="stat-card cursor-pointer transition-colors hover:border-blurple">
        <div class="flex items-center gap-2 text-slate-400">
          <Inbox class="h-4 w-4" />
          <span class="stat-label">Pending Seerr</span>
        </div>
        <div class="stat-number">{{ stats.pendingSeerrCount }}</div>
      </router-link>
      <router-link to="/reminders" class="stat-card cursor-pointer transition-colors hover:border-blurple">
        <div class="flex items-center gap-2 text-slate-400">
          <Clock class="h-4 w-4" />
          <span class="stat-label">Active Reminders</span>
        </div>
        <div class="stat-number">{{ stats.remindersCount }}</div>
      </router-link>
      <div class="stat-card">
        <div class="flex items-center gap-2 text-slate-400">
          <Star class="h-4 w-4" />
          <span class="stat-label">Starboard Posts</span>
        </div>
        <div class="stat-number">{{ stats.starboardCount }}</div>
      </div>
    </div>

    <div v-if="stats" class="mt-8 card">
      <h2 class="text-lg font-semibold text-white">Letzte Mod-Aktionen</h2>
      <div v-if="stats.recentActions.length === 0" class="mt-4 text-sm text-slate-500">
        Noch keine Aktionen aufgezeichnet.
      </div>
      <div v-else class="mt-3">
        <div v-for="a in stats.recentActions" :key="a.id" class="table-row text-sm">
          <div>
            <span class="font-medium text-white">{{ a.action }}</span>
            <span class="ml-2 text-slate-400">von {{ a.moderator }} → {{ a.target }}</span>
          </div>
          <div class="text-xs text-slate-500">{{ new Date(a.createdAt).toLocaleString() }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
