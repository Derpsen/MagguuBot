<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ArrowRight,
  Copy,
  Hash,
  Layers3,
  LoaderCircle,
  Puzzle,
  RefreshCw,
  Trash2,
  Users,
} from '@lucide/vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import EmptyState from '../components/EmptyState.vue';
import PageHero from '../components/PageHero.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

interface RolePanel {
  messageId: string;
  channelId: string;
  channelName: string | null;
  title: string;
  description: string | null;
  roles: Array<{ roleId: string; roleName: string | null; label: string; emoji: string | null }>;
  updatedAt: string;
}

const rows = ref<RolePanel[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const deleting = ref<string | null>(null);
const pendingDelete = ref<RolePanel | null>(null);
const error = ref('');
const toast = useToast();

const roleCount = computed(() => rows.value.reduce((sum, panel) => sum + panel.roles.length, 0));
const channelCount = computed(() => new Set(rows.value.map((panel) => panel.channelId)).size);

async function load(): Promise<void> {
  const initial = rows.value.length === 0;
  if (initial) loading.value = true;
  else refreshing.value = true;
  error.value = '';
  try {
    rows.value = await api<RolePanel[]>('/api/admin/role-panels');
  } catch {
    error.value = 'Die Rollen-Panels konnten gerade nicht geladen werden.';
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function del(panel: RolePanel): Promise<void> {
  deleting.value = panel.messageId;
  try {
    await api(`/api/admin/role-panels/${panel.messageId}`, { method: 'DELETE' });
    rows.value = rows.value.filter((row) => row.messageId !== panel.messageId);
    pendingDelete.value = null;
    toast.success('Panel entfernt', 'Der Verwaltungseintrag wurde gelöscht; die Discord-Nachricht wurde nach Möglichkeit ebenfalls entfernt.');
  } catch {
    toast.error('Löschen fehlgeschlagen', 'Das Panel konnte nicht vollständig entfernt werden.');
  } finally {
    deleting.value = null;
  }
}

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText('/roles-panel');
    toast.success('Befehl kopiert', '/roles-panel liegt jetzt in deiner Zwischenablage.');
  } catch {
    toast.info('Discord-Befehl', '/roles-panel');
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

onMounted(() => void load());
</script>

<template>
  <div>
    <PageHero
      :icon="Puzzle"
      eyebrow="Discord · Rollenverwaltung"
      title="Rollen-Panels"
      description="Verwalte interaktive Rollen-Auswahlen und behalte Kanäle, Buttons und Discord-Nachrichten an einem Ort im Blick."
    >
      <button class="btn-secondary" @click="copyCommand">
        <Copy class="h-4 w-4" />
        <span class="mono text-xs">/roles-panel</span>
      </button>
      <button class="btn-primary" :disabled="loading || refreshing" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading || refreshing ? 'animate-spin' : ''" />
        Aktualisieren
      </button>
    </PageHero>

    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
          <Layers3 class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ rows.length }}</div>
          <div class="text-xs text-slate-500">Aktive Panels</div>
        </div>
      </div>
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
          <Users class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ roleCount }}</div>
          <div class="text-xs text-slate-500">Rollen-Buttons</div>
        </div>
      </div>
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
          <Hash class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ channelCount }}</div>
          <div class="text-xs text-slate-500">Verwendete Kanäle</div>
        </div>
      </div>
    </div>

    <div v-if="error" class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-300">
      <span>{{ error }}</span>
      <button class="btn-ghost btn-sm" @click="load">Erneut versuchen</button>
    </div>

    <div v-if="loading" class="mt-5 grid gap-4 xl:grid-cols-2" aria-label="Rollen-Panels werden geladen">
      <div v-for="i in 4" :key="i" class="skeleton h-48 rounded-[20px]" />
    </div>

    <div v-else-if="!error && rows.length === 0" class="mt-5 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
      <EmptyState
        :icon="Puzzle"
        title="Dein erstes Rollen-Panel wartet"
        description="Erstelle das Panel direkt in Discord. Sobald der Bot die Nachricht gepostet hat, erscheint sie automatisch hier."
      >
        <button class="btn-primary" @click="copyCommand">
          <Copy class="h-4 w-4" />
          Befehl kopieren
        </button>
      </EmptyState>

      <div class="card flex flex-col justify-center">
        <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Schnellstart</div>
        <h2 class="mt-2 text-lg font-semibold text-white">In drei Schritten live</h2>
        <div class="mt-5 space-y-4">
          <div v-for="(step, index) in ['Befehl in Discord ausführen', 'Titel, Kanal und Rollen wählen', 'Panel hier verwalten']" :key="step" class="flex items-center gap-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blurple/20 bg-blurple-soft text-xs font-bold text-violet-300">{{ index + 1 }}</span>
            <span class="text-sm text-slate-300">{{ step }}</span>
            <ArrowRight v-if="index < 2" class="ml-auto h-4 w-4 text-slate-700" />
          </div>
        </div>
        <div class="mt-5 rounded-2xl border border-line bg-surface-2/70 p-4">
          <div class="flex items-center gap-2 text-xs font-semibold text-violet-300">
            <Puzzle class="h-4 w-4" /> Discord-Vorschau
          </div>
          <div class="mt-3 text-sm font-semibold text-white">Wähle deine Rollen</div>
          <div class="mt-2 flex flex-wrap gap-2">
            <span class="rounded-lg bg-blurple px-2.5 py-1.5 text-[11px] font-semibold text-white">🎬 Filme</span>
            <span class="rounded-lg bg-surface-3 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200">📺 Serien</span>
          </div>
        </div>
      </div>
    </div>

    <section v-else-if="rows.length > 0" class="mt-5 grid gap-4" :class="rows.length > 1 ? 'xl:grid-cols-2' : ''" aria-label="Vorhandene Rollen-Panels">
      <article v-for="panel in rows" :key="panel.messageId" class="card group overflow-hidden p-0">
        <div class="border-b border-line bg-gradient-to-r from-blurple/[0.08] to-transparent p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blurple/15 bg-blurple-soft text-violet-300">
                <Puzzle class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <h2 class="truncate text-base font-semibold text-white">{{ panel.title }}</h2>
                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span class="inline-flex items-center gap-1"><Hash class="h-3.5 w-3.5" />{{ panel.channelName ?? panel.channelId }}</span>
                  <span class="text-slate-700">·</span>
                  <span>{{ panel.roles.length }} {{ panel.roles.length === 1 ? 'Rolle' : 'Rollen' }}</span>
                </div>
              </div>
            </div>
            <span class="badge-success"><span class="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live</span>
          </div>
          <p v-if="panel.description" class="mt-4 text-sm leading-relaxed text-slate-400">{{ panel.description }}</p>
        </div>

        <div class="p-5">
          <div class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Discord-Buttons</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <span
              v-for="role in panel.roles"
              :key="role.roleId"
              class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold"
              :class="role.roleName ? 'border-line-strong bg-surface-2 text-slate-200' : 'border-red-500/20 bg-red-500/8 text-red-300'"
            >
              <span v-if="role.emoji" class="text-sm">{{ role.emoji }}</span>
              <span>{{ role.label }}</span>
              <span class="font-normal text-slate-600">@{{ role.roleName ?? 'gelöscht' }}</span>
            </span>
          </div>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2/30 px-5 py-3.5">
          <div class="min-w-0 text-[11px] text-slate-600">
            Aktualisiert {{ formatDate(panel.updatedAt) }}
            <span class="mx-1 text-slate-700">·</span>
            <span class="mono">{{ panel.messageId }}</span>
          </div>
          <button class="btn-ghost btn-sm text-red-300 hover:bg-red-500/10 hover:text-red-200" :disabled="deleting === panel.messageId" @click="pendingDelete = panel">
            <LoaderCircle v-if="deleting === panel.messageId" class="h-3.5 w-3.5 animate-spin" />
            <Trash2 v-else class="h-3.5 w-3.5" />
            Löschen
          </button>
        </footer>
      </article>
    </section>

    <ConfirmDialog
      :open="pendingDelete !== null"
      title="Rollen-Panel entfernen?"
      :description="pendingDelete ? `Der Verwaltungseintrag „${pendingDelete.title}“ wird dauerhaft gelöscht. Der Bot versucht zusätzlich, die zugehörige Discord-Nachricht zu entfernen.` : ''"
      confirm-label="Panel entfernen"
      :busy="pendingDelete !== null && deleting === pendingDelete.messageId"
      @cancel="pendingDelete = null"
      @confirm="pendingDelete && del(pendingDelete)"
    />
  </div>
</template>
