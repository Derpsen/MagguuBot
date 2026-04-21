<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../lib/api';

interface WebhookEvent {
  id: number;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
  createdAt: string;
  channelId?: string | null;
}

const rows = ref<WebhookEvent[]>([]);
const loading = ref(true);
const sourceFilter = ref<string>('all');
const statusFilter = ref<string>('all');
const search = ref('');

const STATUS_COLOR: Record<string, string> = {
  posted: 'bg-green-500/20 text-green-400 ring-1 ring-green-500/30',
  skipped: 'bg-slate-500/20 text-slate-400 ring-1 ring-slate-500/30',
  failed: 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30',
};

const SOURCE_META: Record<string, { emoji: string; color: string; label: string }> = {
  sonarr: { emoji: '📺', color: 'text-sky-400', label: 'Sonarr' },
  radarr: { emoji: '🎬', color: 'text-amber-400', label: 'Radarr' },
  seerr: { emoji: '🙏', color: 'text-violet-400', label: 'Seerr' },
  tautulli: { emoji: '✨', color: 'text-yellow-300', label: 'Tautulli' },
  sabnzbd: { emoji: '📦', color: 'text-yellow-400', label: 'SABnzbd' },
  github: { emoji: '🔨', color: 'text-sky-300', label: 'GitHub' },
  maintainerr: { emoji: '🗑️', color: 'text-slate-400', label: 'Maintainerr' },
  'blue-tracker': { emoji: '🔵', color: 'text-blue-400', label: 'Blue-Tracker' },
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

const sources = computed(() => {
  const set = new Set<string>();
  for (const r of rows.value) set.add(r.source);
  return Array.from(set).sort();
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (sourceFilter.value !== 'all' && r.source !== sourceFilter.value) return false;
    if (statusFilter.value !== 'all' && r.status !== statusFilter.value) return false;
    if (q && !r.eventType.toLowerCase().includes(q) && !r.source.toLowerCase().includes(q)) return false;
    return true;
  });
});

const stats = computed(() => {
  const total = filtered.value.length;
  const posted = filtered.value.filter((r) => r.status === 'posted').length;
  const failed = filtered.value.filter((r) => r.status === 'failed').length;
  const skipped = filtered.value.filter((r) => r.status === 'skipped').length;
  return { total, posted, failed, skipped };
});

async function reload(): Promise<void> {
  loading.value = true;
  rows.value = await api<WebhookEvent[]>('/api/admin/webhooks');
  loading.value = false;
}

onMounted(reload);
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-white">Webhooks</h1>
        <p class="mt-1 text-sm text-slate-400">Die letzten 100 eingehenden Events.</p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="reload">
        {{ loading ? 'Lade…' : 'Reload' }}
      </button>
    </div>

    <div v-if="loading && rows.length === 0" class="mt-8 text-slate-500">Lade…</div>

    <div v-else>
      <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="card px-4 py-3">
          <div class="text-xs text-slate-500">Total (gefiltert)</div>
          <div class="mt-0.5 text-xl font-semibold text-white">{{ stats.total }}</div>
        </div>
        <div class="card px-4 py-3">
          <div class="text-xs text-slate-500">Posted</div>
          <div class="mt-0.5 text-xl font-semibold text-green-400">{{ stats.posted }}</div>
        </div>
        <div class="card px-4 py-3">
          <div class="text-xs text-slate-500">Failed</div>
          <div class="mt-0.5 text-xl font-semibold text-red-400">{{ stats.failed }}</div>
        </div>
        <div class="card px-4 py-3">
          <div class="text-xs text-slate-500">Skipped</div>
          <div class="mt-0.5 text-xl font-semibold text-slate-400">{{ stats.skipped }}</div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <select
          v-model="sourceFilter"
          class="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="all">Alle Quellen</option>
          <option v-for="s in sources" :key="s" :value="s">
            {{ (SOURCE_META[s]?.emoji ?? '🔔') + ' ' + (SOURCE_META[s]?.label ?? s) }}
          </option>
        </select>
        <select
          v-model="statusFilter"
          class="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="all">Alle Status</option>
          <option value="posted">posted</option>
          <option value="failed">failed</option>
          <option value="skipped">skipped</option>
        </select>
        <input
          v-model="search"
          type="search"
          placeholder="Event-Type / Source suchen…"
          class="flex-1 min-w-[200px] rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
        />
      </div>

      <div class="mt-4 card p-0">
        <div v-if="filtered.length === 0" class="p-8 text-center text-slate-500">
          Keine Events passen zum Filter.
        </div>
        <div v-else>
          <div v-for="r in filtered" :key="r.id" class="table-row">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <span class="text-lg">{{ SOURCE_META[r.source]?.emoji ?? '🔔' }}</span>
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-white">
                  <span :class="SOURCE_META[r.source]?.color ?? 'text-slate-300'">{{ SOURCE_META[r.source]?.label ?? r.source }}</span>
                  <span class="text-slate-500"> · </span>
                  <span class="text-slate-300">{{ r.eventType }}</span>
                </div>
                <div v-if="r.error" class="mt-0.5 text-xs text-red-400 truncate" :title="r.error">{{ r.error }}</div>
                <div class="text-xs text-slate-500" :title="new Date(r.createdAt).toLocaleString()">
                  {{ relativeTime(r.createdAt) }}
                </div>
              </div>
            </div>
            <span class="rounded-md px-2 py-0.5 text-xs font-medium" :class="STATUS_COLOR[r.status] ?? 'bg-slate-500/20 text-slate-400'">
              {{ r.status }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
