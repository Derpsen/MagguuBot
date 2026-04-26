<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Plus, Trash2, Rss, AlertTriangle } from 'lucide-vue-next';
import { api } from '../lib/api';

interface RssFeed {
  id: number;
  name: string;
  url: string;
  channelId: string;
  excludeKeywords: string[];
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
}

const feeds = ref<RssFeed[]>([]);
const loading = ref(true);
const saving = ref(false);

const form = ref({
  name: '',
  url: '',
  channelId: '',
  excludeKeywords: '',
  enabled: true,
});
const editingId = ref<number | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  feeds.value = await api<RssFeed[]>('/api/admin/rss');
  loading.value = false;
}

function resetForm(): void {
  form.value = { name: '', url: '', channelId: '', excludeKeywords: '', enabled: true };
  editingId.value = null;
}

function edit(f: RssFeed): void {
  editingId.value = f.id;
  form.value = {
    name: f.name,
    url: f.url,
    channelId: f.channelId,
    excludeKeywords: f.excludeKeywords.join(', '),
    enabled: f.enabled,
  };
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      url: form.value.url.trim(),
      channelId: form.value.channelId.trim(),
      excludeKeywords: form.value.excludeKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      enabled: form.value.enabled,
    };

    if (editingId.value) {
      await api(`/api/admin/rss/${editingId.value}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/admin/rss', { method: 'POST', body: JSON.stringify(payload) });
    }
    resetForm();
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggle(f: RssFeed): Promise<void> {
  await api(`/api/admin/rss/${f.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: !f.enabled }),
  });
  await load();
}

async function remove(f: RssFeed): Promise<void> {
  if (!confirm(`Feed "${f.name}" wirklich löschen?`)) return;
  await api(`/api/admin/rss/${f.id}`, { method: 'DELETE' });
  await load();
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'noch nie';
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

const formValid = computed(
  () => form.value.name.length > 0 && form.value.url.length > 0 && form.value.channelId.length > 0,
);

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">RSS Feeds</h1>
    <p class="mt-1 text-sm text-slate-400">
      Generische RSS-Poller für Blog/News-Feeds. Polling alle 15 Min. Blue-Tracker bleibt separat
      (hardcoded mit Retail-Filter).
    </p>

    <div class="mt-6 card">
      <h2 class="mb-3 text-lg font-semibold text-white">
        {{ editingId ? `Feed #${editingId} bearbeiten` : 'Neuen Feed anlegen' }}
      </h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="text-xs text-slate-400">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="z.B. Icy Veins WoW News"
            maxlength="60"
            class="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-slate-200"
          />
        </div>
        <div>
          <label class="text-xs text-slate-400">Channel ID</label>
          <input
            v-model="form.channelId"
            type="text"
            placeholder="1234567890123456789"
            class="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-slate-200 font-mono"
          />
        </div>
        <div class="sm:col-span-2">
          <label class="text-xs text-slate-400">Feed URL</label>
          <input
            v-model="form.url"
            type="url"
            placeholder="https://example.com/feed.rss"
            class="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-slate-200"
          />
        </div>
        <div class="sm:col-span-2">
          <label class="text-xs text-slate-400">Ausschluss-Keywords (comma-separated, optional)</label>
          <input
            v-model="form.excludeKeywords"
            type="text"
            placeholder="classic, beta, hardcore"
            class="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-slate-200"
          />
          <p class="mt-1 text-xs text-slate-500">Items mit einem dieser Wörter in Titel/Description/Kategorien werden gefiltert.</p>
        </div>
        <div class="sm:col-span-2 flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.enabled" type="checkbox" class="h-4 w-4" />
            Aktiviert
          </label>
          <div class="flex-1" />
          <button v-if="editingId" class="btn-secondary" :disabled="saving" @click="resetForm">
            Abbrechen
          </button>
          <button class="btn-primary" :disabled="!formValid || saving" @click="save">
            <Plus class="h-4 w-4" />
            {{ editingId ? 'Speichern' : 'Feed anlegen' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading && feeds.length === 0" class="mt-6 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0 overflow-hidden">
      <div v-if="feeds.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Feeds. Der erste kommt oben.
      </div>
      <div v-else>
        <div
          v-for="(f, idx) in feeds"
          :key="f.id"
          class="flex items-center gap-4 border-b border-line/50 px-4 py-3 last:border-0 hover:bg-surface-2/60"
          :class="idx % 2 === 0 ? 'bg-transparent' : 'bg-surface-2/20'"
        >
          <Rss
            class="h-5 w-5 shrink-0"
            :class="f.lastError ? 'text-red-400' : f.enabled ? 'text-sky-400' : 'text-slate-600'"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium text-white">{{ f.name }}</span>
              <span class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                :class="f.enabled ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'">
                {{ f.enabled ? 'aktiv' : 'paused' }}
              </span>
              <span
                v-if="f.lastError"
                class="inline-flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
                :title="f.lastError"
              >
                <AlertTriangle class="h-3 w-3" />
                Fehler
              </span>
            </div>
            <div class="truncate text-xs text-slate-500" :title="f.url">{{ f.url }}</div>
            <div class="text-xs text-slate-500">
              → <code>#{{ f.channelId.slice(-5) }}</code>
              <span v-if="f.excludeKeywords.length"> · 🚫 {{ f.excludeKeywords.join(', ') }}</span>
              · last run: {{ relativeTime(f.lastRunAt) }}
            </div>
            <div v-if="f.lastError" class="mt-1 truncate text-xs text-red-400" :title="f.lastError">
              {{ f.lastError }} <span class="text-red-400/60">· {{ relativeTime(f.lastErrorAt) }}</span>
            </div>
          </div>
          <button class="btn-secondary" @click="toggle(f)">
            {{ f.enabled ? 'Pause' : 'Resume' }}
          </button>
          <button class="btn-secondary" @click="edit(f)">Edit</button>
          <button class="btn-danger" @click="remove(f)">
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
