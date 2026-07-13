<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Check,
  Clock,
  Film,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Search,
  Tv,
  X,
} from '@lucide/vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import EmptyState from '../components/EmptyState.vue';
import PageHero from '../components/PageHero.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

type RequestStatus = 'pending' | 'approved' | 'declined' | 'available' | 'failed' | 'deleted';
type StatusFilter = 'all' | RequestStatus;
type MediaFilter = 'all' | 'movie' | 'tv';

interface SeerrRequest {
  id: number;
  seerrRequestId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  status: RequestStatus;
  requestedBy: string | null;
  createdAt: string;
}

const STATUS_META: Record<RequestStatus, { label: string; className: string; dotClass: string }> = {
  pending: { label: 'Ausstehend', className: 'border-amber-400/20 bg-amber-400/10 text-amber-300', dotClass: 'bg-amber-400' },
  approved: { label: 'Freigegeben', className: 'border-violet-400/20 bg-violet-400/10 text-violet-300', dotClass: 'bg-violet-400' },
  declined: { label: 'Abgelehnt', className: 'border-red-400/20 bg-red-400/10 text-red-300', dotClass: 'bg-red-400' },
  available: { label: 'Verfügbar', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300', dotClass: 'bg-emerald-400' },
  failed: { label: 'Fehlgeschlagen', className: 'border-orange-400/20 bg-orange-400/10 text-orange-300', dotClass: 'bg-orange-400' },
  deleted: { label: 'Entfernt', className: 'border-slate-400/15 bg-slate-400/8 text-slate-400', dotClass: 'bg-slate-500' },
};

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'pending', label: 'Offen' },
  { value: 'approved', label: 'Freigegeben' },
  { value: 'available', label: 'Verfügbar' },
  { value: 'declined', label: 'Abgelehnt' },
  { value: 'failed', label: 'Fehler' },
  { value: 'deleted', label: 'Entfernt' },
];

const MEDIA_FILTERS: Array<{ value: MediaFilter; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'movie', label: 'Filme' },
  { value: 'tv', label: 'Serien' },
];

const rows = ref<SeerrRequest[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref('');
const busyIds = ref<Set<number>>(new Set());
const pendingDecline = ref<SeerrRequest | null>(null);
const query = ref('');
const statusFilter = ref<StatusFilter>('all');
const mediaFilter = ref<MediaFilter>('all');
const toast = useToast();

const statusCounts = computed<Record<RequestStatus, number>>(() => {
  const counts: Record<RequestStatus, number> = { pending: 0, approved: 0, declined: 0, available: 0, failed: 0, deleted: 0 };
  for (const row of rows.value) counts[row.status] += 1;
  return counts;
});

const completedCount = computed(() => statusCounts.value.approved + statusCounts.value.available);
const filteredRows = computed(() => {
  const search = query.value.trim().toLocaleLowerCase('de');
  return rows.value
    .filter((row) => statusFilter.value === 'all' || row.status === statusFilter.value)
    .filter((row) => mediaFilter.value === 'all' || row.mediaType === mediaFilter.value)
    .filter((row) => !search || row.title.toLocaleLowerCase('de').includes(search) || (row.requestedBy ?? '').toLocaleLowerCase('de').includes(search) || String(row.seerrRequestId).includes(search))
    .slice()
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
});

const statusSegments = computed(() => {
  const total = rows.value.length;
  return (Object.keys(STATUS_META) as RequestStatus[]).map((status) => ({
    status,
    width: total > 0 ? (statusCounts.value[status] / total) * 100 : 0,
  }));
});

async function load(): Promise<void> {
  const initial = rows.value.length === 0;
  if (initial) loading.value = true;
  else refreshing.value = true;
  error.value = '';
  try {
    rows.value = await api<SeerrRequest[]>('/api/admin/seerr');
  } catch {
    error.value = 'Die Seerr-Anfragen konnten gerade nicht aktualisiert werden.';
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function updateStatus(row: SeerrRequest, nextStatus: 'approved' | 'declined'): Promise<boolean> {
  busyIds.value = new Set(busyIds.value).add(row.seerrRequestId);
  try {
    await api(`/api/admin/seerr/${row.seerrRequestId}/${nextStatus === 'approved' ? 'approve' : 'decline'}`, { method: 'POST' });
    row.status = nextStatus;
    toast.success(
      nextStatus === 'approved' ? 'Anfrage freigegeben' : 'Anfrage abgelehnt',
      row.title,
    );
    return true;
  } catch {
    toast.error('Aktion fehlgeschlagen', `„${row.title}“ konnte nicht aktualisiert werden.`);
    return false;
  } finally {
    const nextBusy = new Set(busyIds.value);
    nextBusy.delete(row.seerrRequestId);
    busyIds.value = nextBusy;
  }
}

async function confirmDecline(): Promise<void> {
  const row = pendingDecline.value;
  if (!row) return;
  if (await updateStatus(row, 'declined')) pendingDecline.value = null;
}

function isBusy(id: number): boolean {
  return busyIds.value.has(id);
}

function filterCount(filter: StatusFilter): number {
  return filter === 'all' ? rows.value.length : statusCounts.value[filter];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

onMounted(() => void load());
</script>

<template>
  <div>
    <PageHero
      :icon="Inbox"
      eyebrow="Medien · Freigaben"
      title="Seerr-Anfragen"
      description="Offene Medienwünsche priorisieren, direkt freigeben und den Status der letzten 100 Anfragen nachvollziehen."
    >
      <div class="inline-flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.07] px-3 py-2 text-xs font-semibold text-emerald-300">
        <span class="h-2 w-2 rounded-full bg-emerald-400" />
        {{ statusCounts.pending }} offen
      </div>
      <button class="btn-primary" :disabled="loading || refreshing" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading || refreshing ? 'animate-spin' : ''" />
        Aktualisieren
      </button>
    </PageHero>

    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
          <Clock class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ statusCounts.pending }}</div>
          <div class="text-xs text-slate-500">Warten auf Entscheidung</div>
        </div>
      </div>
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
          <Check class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ completedCount }}</div>
          <div class="text-xs text-slate-500">Freigegeben / verfügbar</div>
        </div>
      </div>
      <div class="metric-tile">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xl font-bold text-white">{{ rows.length }}</div>
            <div class="text-xs text-slate-500">Letzte Anfragen</div>
          </div>
          <div class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Statusmix</div>
        </div>
        <div class="mt-3 flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-label="Statusverteilung">
          <span
            v-for="segment in statusSegments"
            :key="segment.status"
            :style="{ width: `${segment.width}%` }"
            :class="STATUS_META[segment.status].dotClass"
            :title="`${STATUS_META[segment.status].label}: ${statusCounts[segment.status]}`"
          />
        </div>
      </div>
    </div>

    <div v-if="error" class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-300">
      <span>{{ error }}<span v-if="rows.length"> Die letzte Ansicht bleibt sichtbar.</span></span>
      <button class="btn-ghost btn-sm" @click="load">Erneut versuchen</button>
    </div>

    <div v-if="loading" class="mt-5 space-y-3" aria-label="Anfragen werden geladen">
      <div class="skeleton h-24 rounded-[20px]" />
      <div v-for="i in 5" :key="i" class="skeleton h-24 rounded-[20px]" />
    </div>

    <template v-else-if="rows.length > 0">
      <section class="mt-5 card-flush overflow-hidden" aria-label="Filter für Seerr-Anfragen">
        <div class="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <label class="relative min-w-0 flex-1 lg:max-w-md">
            <span class="sr-only">Anfragen suchen</span>
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input v-model="query" type="search" class="input py-2 pl-9" placeholder="Titel, Person oder Request-ID suchen …" />
          </label>
          <div class="flex rounded-xl border border-line bg-surface-2/60 p-1" aria-label="Medientyp filtern">
            <button v-for="option in MEDIA_FILTERS" :key="option.value" class="rounded-lg px-3 py-1.5 text-xs font-semibold transition" :class="mediaFilter === option.value ? 'bg-surface-3 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'" @click="mediaFilter = option.value">
              {{ option.label }}
            </button>
          </div>
          <div class="ml-auto text-xs text-slate-600">{{ filteredRows.length }} von {{ rows.length }}</div>
        </div>
        <div class="flex gap-1 overflow-x-auto px-3 py-2.5" aria-label="Status filtern">
          <button v-for="filter in FILTERS" :key="filter.value" class="filter-pill" :class="statusFilter === filter.value ? 'filter-pill-active' : ''" @click="statusFilter = filter.value">
            {{ filter.label }}
            <span class="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px]">{{ filterCount(filter.value) }}</span>
          </button>
        </div>
      </section>

      <section class="mt-4 card-flush overflow-hidden" aria-live="polite">
        <div v-if="filteredRows.length === 0" class="px-5 py-12 text-center">
          <Search class="mx-auto h-6 w-6 text-slate-600" />
          <div class="mt-3 text-sm font-semibold text-slate-300">Keine passenden Anfragen</div>
          <p class="mt-1 text-xs text-slate-600">Passe Suche oder Filter an.</p>
        </div>

        <template v-else>
          <article v-for="row in filteredRows" :key="row.id" class="flex flex-col gap-4 border-b border-line p-4 last:border-0 hover:bg-surface-2/35 sm:p-5 lg:flex-row lg:items-center">
          <div class="flex min-w-0 flex-1 items-start gap-3.5">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border" :class="row.mediaType === 'movie' ? 'border-violet-400/15 bg-violet-400/[0.08] text-violet-300' : 'border-cyan-400/15 bg-cyan-400/[0.08] text-cyan-300'">
              <Film v-if="row.mediaType === 'movie'" class="h-5 w-5" />
              <Tv v-else class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-[0.14em]" :class="row.mediaType === 'movie' ? 'text-violet-300/75' : 'text-cyan-300/75'">{{ row.mediaType === 'movie' ? 'Film' : 'Serie' }}</span>
                <span class="text-[11px] text-slate-700">Request #{{ row.seerrRequestId }}</span>
              </div>
              <h2 class="mt-1 truncate text-sm font-semibold text-white sm:text-base">{{ row.title }}</h2>
              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>von {{ row.requestedBy ?? 'Unbekannt' }}</span>
                <span class="text-slate-700">·</span>
                <time :datetime="row.createdAt" :title="new Date(row.createdAt).toLocaleString('de-DE')">{{ formatDate(row.createdAt) }}</time>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
            <span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold" :class="STATUS_META[row.status].className">
              <span class="h-1.5 w-1.5 rounded-full" :class="STATUS_META[row.status].dotClass" />
              {{ STATUS_META[row.status].label }}
            </span>
            <div v-if="row.status === 'pending'" class="flex w-full gap-2 sm:w-auto">
              <button class="btn-success flex-1 sm:flex-none" :disabled="isBusy(row.seerrRequestId)" @click="updateStatus(row, 'approved')">
                <LoaderCircle v-if="isBusy(row.seerrRequestId)" class="h-4 w-4 animate-spin" />
                <Check v-else class="h-4 w-4" />
                Freigeben
              </button>
              <button class="btn-secondary flex-1 text-red-300 hover:border-red-400/20 hover:bg-red-500/10 sm:flex-none" :disabled="isBusy(row.seerrRequestId)" @click="pendingDecline = row">
                <X class="h-4 w-4" />
                Ablehnen
              </button>
            </div>
          </div>
          </article>
        </template>
      </section>
    </template>

    <EmptyState
      v-else-if="!error"
      class="mt-5"
      :icon="Inbox"
      title="Noch keine Seerr-Anfragen"
      description="Neue Medienwünsche erscheinen hier automatisch, sobald der Bot einen Seerr-Webhook verarbeitet hat."
    />

    <ConfirmDialog
      :open="pendingDecline !== null"
      title="Anfrage ablehnen?"
      :description="pendingDecline ? `„${pendingDecline.title}“ wird in Seerr abgelehnt. Diese Aktion solltest du nur ausführen, wenn die Medienanfrage wirklich nicht erfüllt werden soll.` : ''"
      confirm-label="Anfrage ablehnen"
      :busy="pendingDecline !== null && isBusy(pendingDecline.seerrRequestId)"
      @cancel="pendingDecline = null"
      @confirm="confirmDecline"
    />
  </div>
</template>
