<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  Clock,
  ShieldAlert,
  Trophy,
  Webhook,
  Inbox,
  Star,
  Tag as TagIcon,
  Ticket,
  Calendar,
} from '@lucide/vue';
import { api, ApiError } from '../lib/api';
import Skeleton from '../components/Skeleton.vue';

interface Stats {
  uptimeSeconds: number;
  warningsCount: number;
  webhooksLast24h: number;
  topUser: { username: string; xp: number; level: number } | null;
  recentActions: Array<{ id: number; action: string; moderator: string; target: string; createdAt: string }>;
  remindersCount: number;
  pendingSeerrCount: number;
  starboardCount: number;
  tagsCount: number;
  openTicketsCount: number;
  scheduledPending: number;
  automations: { weeklyDigest: boolean; downloadLive: boolean; movieNight: boolean; automaticBackup: boolean; webhookRetry: boolean; plexActivityRetentionDays: number };
}

interface ServiceHealth {
  key: string;
  label: string;
  state: 'ok' | 'error' | 'disabled' | 'waiting';
  latencyMs: number | null;
  detail: string;
  lastEventAt: string | null;
}

interface SeerrWeekly {
  sinceIso: string;
  total: number;
  approved: number;
  declined: number;
  failed: number;
  pending: number;
  declineRate: number;
}

const stats = ref<Stats | null>(null);
const seerrWeekly = ref<SeerrWeekly | null>(null);
const services = ref<ServiceHealth[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const loadError = ref('');
const lastUpdated = ref<Date | null>(null);
let refreshTimer: number | null = null;

async function load(forceServices = false): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const [s, w, serviceResponse] = await Promise.all([
      api<Stats>('/api/admin/stats'),
      api<SeerrWeekly>('/api/admin/seerr/weekly').catch(() => null),
      api<{ services: ServiceHealth[] }>(`/api/admin/services/health${forceServices ? '?force=true' : ''}`).catch(() => ({ services: [] })),
    ]);
    stats.value = s;
    seerrWeekly.value = w;
    services.value = serviceResponse.services;
    lastUpdated.value = new Date();
    loadError.value = '';
  } catch (err) {
    loadError.value = 'Live-Daten konnten gerade nicht aktualisiert werden.';
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      window.location.assign('/login');
    }
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

onMounted(() => {
  void load();
  refreshTimer = window.setInterval(() => void load(), 30_000);
});
onUnmounted(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
});

const requestSegments = computed(() => {
  const total = seerrWeekly.value?.total ?? 0;
  if (!total || !seerrWeekly.value) return [];
  let x = 0;
  return [
    { label: 'Approved', value: seerrWeekly.value.approved, color: 'bg-emerald-500', fill: '#10b981' },
    { label: 'Pending', value: seerrWeekly.value.pending, color: 'bg-amber-500', fill: '#f59e0b' },
    { label: 'Declined', value: seerrWeekly.value.declined, color: 'bg-red-500', fill: '#ef4444' },
    { label: 'Failed', value: seerrWeekly.value.failed, color: 'bg-orange-500', fill: '#f97316' },
  ].map((segment) => {
    const width = Math.max(0, (segment.value / total) * 100);
    const result = { ...segment, width, x };
    x += width;
    return result;
  });
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
    <div class="page-header">
      <div>
        <h1 class="page-title">Übersicht</h1>
        <p class="page-subtitle">Live-Status deines Bots und der letzten Aktivität.</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-500">
        <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        Live · {{ lastUpdated?.toLocaleTimeString() ?? 'verbinde …' }}
        <button class="btn-ghost btn-sm" :disabled="refreshing" @click="load()">↻</button>
      </div>
    </div>

    <div v-if="loadError" class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      {{ loadError }} Die letzte erfolgreiche Ansicht bleibt sichtbar.
    </div>

    <div v-if="loading" class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div v-for="i in 8" :key="i" class="skeleton h-24" />
    </div>

    <div v-else-if="stats" class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div class="stat-card">
        <div class="flex items-center gap-2">
          <Clock class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Uptime</span>
        </div>
        <div class="stat-number">{{ formatUptime(stats.uptimeSeconds) }}</div>
      </div>
      <div class="stat-card">
        <div class="flex items-center gap-2">
          <Webhook class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Webhooks 24h</span>
        </div>
        <div class="stat-number">{{ stats.webhooksLast24h }}</div>
      </div>
      <router-link to="/warnings" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <ShieldAlert class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Verwarnungen</span>
        </div>
        <div class="stat-number">{{ stats.warningsCount }}</div>
      </router-link>
      <router-link to="/leaderboard" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <Trophy class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Top-Nutzer</span>
        </div>
        <div v-if="stats.topUser" class="stat-number">
          {{ stats.topUser.username }}
          <span class="ml-1 text-sm font-normal text-slate-500">Lv {{ stats.topUser.level }}</span>
        </div>
        <div v-else class="stat-number text-slate-600">—</div>
      </router-link>
      <router-link to="/requests" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <Inbox class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Offene Seerr-Anfragen</span>
        </div>
        <div class="stat-number">{{ stats.pendingSeerrCount }}</div>
      </router-link>
      <router-link to="/tickets" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <Ticket class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Offene Tickets</span>
        </div>
        <div class="stat-number">{{ stats.openTicketsCount }}</div>
      </router-link>
      <router-link to="/reminders" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <Clock class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Aktive Erinnerungen</span>
        </div>
        <div class="stat-number">{{ stats.remindersCount }}</div>
      </router-link>
      <router-link to="/scheduled" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <Calendar class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Geplant</span>
        </div>
        <div class="stat-number">{{ stats.scheduledPending }}</div>
      </router-link>
      <router-link to="/tags" class="stat-card clickable">
        <div class="flex items-center gap-2">
          <TagIcon class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Tags</span>
        </div>
        <div class="stat-number">{{ stats.tagsCount }}</div>
      </router-link>
      <div class="stat-card">
        <div class="flex items-center gap-2">
          <Star class="h-4 w-4 text-slate-500" />
          <span class="stat-label">Starboard</span>
        </div>
        <div class="stat-number">{{ stats.starboardCount }}</div>
      </div>
    </div>

    <div v-if="services.length" class="mt-6 card">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-white">Dienste</h2>
          <p class="mt-0.5 text-xs text-slate-500">Direkte Erreichbarkeit und letzter Maintainerr-Webhook</p>
        </div>
        <button class="btn-ghost btn-sm" :disabled="refreshing" @click="load(true)">Neu prüfen</button>
      </div>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="service in services" :key="service.key" class="rounded-lg border border-line bg-surface-2 px-4 py-3">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium text-white">{{ service.label }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-medium"
              :class="service.state === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : service.state === 'error' ? 'bg-red-500/15 text-red-400' : service.state === 'waiting' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/15 text-slate-400'"
            >
              {{ service.state === 'ok' ? 'online' : service.state === 'error' ? 'Fehler' : service.state === 'waiting' ? 'wartet' : 'deaktiviert' }}
            </span>
          </div>
          <div class="mt-1 text-xs text-slate-400">{{ service.detail }}</div>
          <div v-if="service.latencyMs !== null" class="mt-1 text-[11px] text-slate-600">{{ service.latencyMs }} ms</div>
          <div v-else-if="service.lastEventAt" class="mt-1 text-[11px] text-slate-600">Letztes Event: {{ new Date(service.lastEventAt).toLocaleString() }}</div>
        </div>
      </div>
    </div>

    <div v-if="seerrWeekly && seerrWeekly.total > 0" class="mt-6 card">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">Seerr — diese Woche</h2>
        <router-link to="/requests" class="text-xs text-blurple hover:underline">Alle Requests →</router-link>
      </div>
      <div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div>
          <div class="stat-label">Total</div>
          <div class="stat-number">{{ seerrWeekly.total }}</div>
        </div>
        <div>
          <div class="stat-label">Approved</div>
          <div class="stat-number text-green-400">{{ seerrWeekly.approved }}</div>
        </div>
        <div>
          <div class="stat-label">Declined</div>
          <div class="stat-number text-red-400">{{ seerrWeekly.declined }}</div>
        </div>
        <div>
          <div class="stat-label">Failed</div>
          <div class="stat-number text-orange-400">{{ seerrWeekly.failed }}</div>
        </div>
        <div>
          <div class="stat-label">Decline-Rate</div>
          <div class="stat-number">{{ seerrWeekly.declineRate }}%</div>
        </div>
      </div>
      <svg class="mt-5 h-2 w-full overflow-hidden rounded-full bg-surface-3" viewBox="0 0 100 8" preserveAspectRatio="none" aria-label="Request-Verteilung">
        <rect
          v-for="segment in requestSegments"
          :key="segment.label"
          :x="segment.x"
          y="0"
          :width="segment.width"
          height="8"
          :fill="segment.fill"
        ><title>{{ segment.label }}: {{ segment.value }}</title></rect>
      </svg>
      <div class="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-500">
        <span v-for="segment in requestSegments" :key="segment.label" class="flex items-center gap-1.5">
          <span class="h-2 w-2 rounded-full" :class="segment.color" />
          {{ segment.label }} {{ segment.value }}
        </span>
      </div>
    </div>

    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      <div class="card overflow-hidden">
        <div class="stat-label">Discord-Vorschau · Request-Lifecycle</div>
        <div class="mt-3 rounded-lg border-l-4 border-emerald-500 bg-surface-2 p-4">
          <div class="text-xs font-medium text-violet-400">Seerr · Request #42</div>
          <div class="mt-1 text-lg font-semibold text-white">🎬 Beispiel-Film · 2026</div>
          <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span class="text-slate-500">Status</span><br /><span class="text-emerald-400">🎉 Available</span></div>
            <div><span class="text-slate-500">Type</span><br />Movie</div>
          </div>
          <div class="mt-3 text-xs text-slate-500">Eine Nachricht · alle Statuswechsel</div>
        </div>
      </div>
      <div class="card">
        <div class="stat-label">Automationen</div>
        <div class="mt-3 space-y-3 text-sm">
          <div class="flex items-center justify-between"><span>📊 Wochenrückblick</span><span :class="stats?.automations.weeklyDigest ? 'badge-success' : 'badge-muted'">{{ stats?.automations.weeklyDigest ? 'aktiv' : 'nicht eingerichtet' }}</span></div>
          <div class="flex items-center justify-between"><span>📡 Live-Downloads</span><span :class="stats?.automations.downloadLive ? 'badge-success' : 'badge-muted'">{{ stats?.automations.downloadLive ? 'aktiv · 60s' : 'deaktiviert' }}</span></div>
          <div class="flex items-center justify-between"><span>🎬 Movie-Night Reminder</span><span :class="stats?.automations.movieNight ? 'badge-success' : 'badge-muted'">{{ stats?.automations.movieNight ? 'bereit' : 'nicht eingerichtet' }}</span></div>
          <div class="flex items-center justify-between"><span>↻ Webhook-Replay</span><router-link to="/webhooks" class="text-blurple">öffnen →</router-link></div>
          <div class="flex items-center justify-between"><span>💾 Automatische Backups</span><span :class="stats?.automations.automaticBackup ? 'badge-success' : 'badge-muted'">{{ stats?.automations.automaticBackup ? 'täglich aktiv' : 'deaktiviert' }}</span></div>
          <div class="flex items-center justify-between"><span>🔁 Webhook-Retries</span><span :class="stats?.automations.webhookRetry ? 'badge-success' : 'badge-muted'">{{ stats?.automations.webhookRetry ? 'automatisch' : 'deaktiviert' }}</span></div>
          <div class="flex items-center justify-between"><span>🎞️ Plex-Aktivitätskarten</span><span class="badge-success">Film/Serie pro Stream · Musik pro Player · {{ stats?.automations.plexActivityRetentionDays === 0 ? 'dauerhaft' : `${stats?.automations.plexActivityRetentionDays} Tage` }}</span></div>
        </div>
      </div>
    </div>

    <div v-if="stats" class="mt-6 card">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">Letzte Mod-Aktionen</h2>
        <router-link to="/warnings" class="text-xs text-blurple hover:underline">Alle →</router-link>
      </div>
      <div v-if="stats.recentActions.length === 0" class="mt-4 text-sm text-slate-500">
        Noch keine Aktionen aufgezeichnet.
      </div>
      <div v-else class="mt-3 -mx-1">
        <div v-for="a in stats.recentActions" :key="a.id" class="row text-sm">
          <div class="flex items-center gap-2">
            <span class="badge-warn">{{ a.action }}</span>
            <span class="text-slate-400">{{ a.moderator }} → {{ a.target }}</span>
          </div>
          <div class="text-xs text-slate-500">{{ new Date(a.createdAt).toLocaleString() }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="!loading" class="mt-6 card">
      <Skeleton :rows="3" />
    </div>
  </div>
</template>
