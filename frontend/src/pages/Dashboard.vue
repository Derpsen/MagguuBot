<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
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
  automations: { weeklyDigest: boolean; downloadLive: boolean; movieNight: boolean; automaticBackup: boolean; webhookRetry: boolean; plexActivityRetentionDays: number; plexStaleSessionMinutes: number };
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
    { label: 'Approved', value: seerrWeekly.value.approved, color: 'bg-emerald-500', fill: '#0cd29d' },
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
        <p class="mini-label">Übersicht</p>
        <h1 class="page-title mt-1.5">MagguuBot</h1>
        <p class="page-subtitle">Live-Status des Bots und der letzten Aktivität.</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <span class="h-1.5 w-1.5 rounded-full bg-brand-400" />
        Live · {{ lastUpdated?.toLocaleTimeString() ?? 'verbinde …' }}
        <button class="btn-ghost btn-sm" :disabled="refreshing" @click="load()">Aktualisieren</button>
      </div>
    </div>

    <p v-if="loadError" class="mt-4 border-t border-amber-300/40 pt-3 text-sm text-amber-300">
      {{ loadError }} Die letzte erfolgreiche Ansicht bleibt sichtbar.
    </p>

    <section class="mt-8 border-t border-line pt-5">
      <p class="mini-label">Status</p>
      <div v-if="loading" class="mt-3"><Skeleton :rows="2" /></div>
      <dl v-else-if="stats" class="mt-3 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <div><dt class="text-xs text-slate-400">Uptime</dt><dd class="stat-number">{{ formatUptime(stats.uptimeSeconds) }}</dd></div>
        <div><dt class="text-xs text-slate-400">Webhooks 24 h</dt><dd class="stat-number">{{ stats.webhooksLast24h }}</dd></div>
        <router-link to="/requests" class="group"><dt class="text-xs text-slate-400">Offene Anfragen</dt><dd class="stat-number group-hover:underline underline-offset-4">{{ stats.pendingSeerrCount }}</dd></router-link>
        <router-link to="/moderation?tab=tickets" class="group"><dt class="text-xs text-slate-400">Offene Tickets</dt><dd class="stat-number group-hover:underline underline-offset-4">{{ stats.openTicketsCount }}</dd></router-link>
        <router-link to="/moderation?tab=warnings" class="group"><dt class="text-xs text-slate-400">Verwarnungen</dt><dd class="stat-number group-hover:underline underline-offset-4">{{ stats.warningsCount }}</dd></router-link>
      </dl>
      <p v-if="stats" class="mt-4 text-sm leading-7 text-silver-300">
        <router-link to="/members?tab=xp" class="hover:underline underline-offset-4">Top-Nutzer {{ stats.topUser ? `${stats.topUser.username} · Lv ${stats.topUser.level}` : '—' }}</router-link>
        <span class="px-1.5 text-white/25">·</span>
        <router-link to="/members?tab=reminders" class="hover:underline underline-offset-4">Erinnerungen {{ stats.remindersCount }}</router-link>
        <span class="px-1.5 text-white/25">·</span>
        <router-link to="/content?tab=scheduled" class="hover:underline underline-offset-4">Geplant {{ stats.scheduledPending }}</router-link>
        <span class="px-1.5 text-white/25">·</span>
        <router-link to="/content?tab=tags" class="hover:underline underline-offset-4">Tags {{ stats.tagsCount }}</router-link>
        <span class="px-1.5 text-white/25">·</span>
        <span>Starboard {{ stats.starboardCount }}</span>
      </p>
    </section>

    <section v-if="services.length" class="mt-8 border-t border-line pt-5">
      <div class="flex items-center justify-between">
        <p class="mini-label">Dienste</p>
        <button class="btn-ghost btn-sm" :disabled="refreshing" @click="load(true)">Neu prüfen</button>
      </div>
      <ul class="mt-2">
        <li v-for="service in services" :key="service.key" class="row text-sm">
          <span class="font-medium text-white">{{ service.label }}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-slate-400">{{ service.detail }}</span>
          <span v-if="service.latencyMs !== null" class="font-mono text-[11px] text-slate-500">{{ service.latencyMs }} ms</span>
          <span v-else-if="service.lastEventAt" class="text-[11px] text-slate-500">{{ new Date(service.lastEventAt).toLocaleString() }}</span>
          <span
            class="w-20 text-right text-xs font-medium"
            :class="service.state === 'ok' ? 'text-brand-300' : service.state === 'error' ? 'text-red-400' : service.state === 'waiting' ? 'text-amber-300' : 'text-slate-500'"
          >
            {{ service.state === 'ok' ? 'online' : service.state === 'error' ? 'Fehler' : service.state === 'waiting' ? 'wartet' : 'deaktiviert' }}
          </span>
        </li>
      </ul>
    </section>

    <section v-if="seerrWeekly && seerrWeekly.total > 0" class="mt-8 border-t border-line pt-5">
      <div class="flex items-center justify-between">
        <p class="mini-label">Seerr · diese Woche</p>
        <router-link to="/requests" class="text-xs text-brand-300 hover:underline">Alle Anfragen</router-link>
      </div>
      <p class="mt-3 text-sm leading-7 text-silver-300">
        Gesamt <strong class="text-white">{{ seerrWeekly.total }}</strong>
        <span class="px-1.5 text-white/25">·</span> Freigegeben <strong class="text-brand-300">{{ seerrWeekly.approved }}</strong>
        <span class="px-1.5 text-white/25">·</span> Abgelehnt <strong class="text-red-400">{{ seerrWeekly.declined }}</strong>
        <span class="px-1.5 text-white/25">·</span> Fehlgeschlagen <strong class="text-amber-300">{{ seerrWeekly.failed }}</strong>
        <span class="px-1.5 text-white/25">·</span> Ablehnungsquote <strong class="text-white">{{ seerrWeekly.declineRate }}%</strong>
      </p>
      <svg class="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10" viewBox="0 0 100 8" preserveAspectRatio="none" aria-label="Request-Verteilung">
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
    </section>

    <section v-if="stats" class="mt-8 border-t border-line pt-5">
      <p class="mini-label">Automationen</p>
      <ul class="mt-2 text-sm">
        <li class="row"><span>Wochenrückblick</span><span :class="stats.automations.weeklyDigest ? 'badge-success' : 'badge-muted'">{{ stats.automations.weeklyDigest ? 'aktiv' : 'nicht eingerichtet' }}</span></li>
        <li class="row"><span>Live-Downloads</span><span :class="stats.automations.downloadLive ? 'badge-success' : 'badge-muted'">{{ stats.automations.downloadLive ? 'aktiv · 60 s' : 'deaktiviert' }}</span></li>
        <li class="row"><span>Movie-Night-Erinnerung</span><span :class="stats.automations.movieNight ? 'badge-success' : 'badge-muted'">{{ stats.automations.movieNight ? 'bereit' : 'nicht eingerichtet' }}</span></li>
        <li class="row"><span>Automatische Backups</span><span :class="stats.automations.automaticBackup ? 'badge-success' : 'badge-muted'">{{ stats.automations.automaticBackup ? 'täglich aktiv' : 'deaktiviert' }}</span></li>
        <li class="row"><span>Webhook-Retries</span><span :class="stats.automations.webhookRetry ? 'badge-success' : 'badge-muted'">{{ stats.automations.webhookRetry ? 'automatisch' : 'deaktiviert' }}</span></li>
        <li class="row"><span>Plex-Aktivitätskarten</span><span class="badge-success">{{ stats.automations.plexActivityRetentionDays === 0 ? 'dauerhaft' : `${stats.automations.plexActivityRetentionDays} Tage` }}</span></li>
        <li class="row"><span>Plex-Session-Timeout</span><span :class="stats.automations.plexStaleSessionMinutes ? 'badge-success' : 'badge-muted'">{{ stats.automations.plexStaleSessionMinutes ? `${stats.automations.plexStaleSessionMinutes} Min` : 'deaktiviert' }}</span></li>
      </ul>
    </section>

    <section v-if="stats" class="mt-8 border-t border-line pt-5">
      <div class="flex items-center justify-between">
        <p class="mini-label">Letzte Mod-Aktionen</p>
        <router-link to="/moderation?tab=warnings" class="text-xs text-brand-300 hover:underline">Alle</router-link>
      </div>
      <p v-if="stats.recentActions.length === 0" class="mt-3 text-sm text-slate-400">
        Noch keine Aktionen aufgezeichnet.
      </p>
      <ul v-else class="mt-2">
        <li v-for="a in stats.recentActions" :key="a.id" class="row text-sm">
          <span class="flex items-center gap-3">
            <span class="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-300">{{ a.action }}</span>
            <span class="text-slate-400">{{ a.moderator }} → {{ a.target }}</span>
          </span>
          <span class="text-xs text-slate-500">{{ new Date(a.createdAt).toLocaleString() }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
