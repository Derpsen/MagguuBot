<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Copy,
  Crown,
  Medal,
  MessageSquare,
  RefreshCw,
  Search,
  Trophy,
  Users,
  Zap,
} from '@lucide/vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import EmptyState from '../components/EmptyState.vue';
import PageHero from '../components/PageHero.vue';

interface XpRow {
  userId: string;
  username: string;
  xp: number;
  level: number;
  messagesCounted: number;
}

interface RankedXpRow extends XpRow {
  rank: number;
}

const rows = ref<XpRow[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref('');
const query = ref('');
const toast = useToast();

const rankedRows = computed<RankedXpRow[]>(() => rows.value.map((row, index) => ({ ...row, rank: index + 1 })));
const topThree = computed(() => rankedRows.value.slice(0, 3));
const totalXp = computed(() => rows.value.reduce((sum, row) => sum + row.xp, 0));
const totalMessages = computed(() => rows.value.reduce((sum, row) => sum + row.messagesCounted, 0));
const listRows = computed(() => {
  const search = query.value.trim().toLocaleLowerCase('de');
  if (!search) return rankedRows.value.slice(3);
  return rankedRows.value.filter((row) => row.username.toLocaleLowerCase('de').includes(search) || row.userId.includes(search));
});

async function load(): Promise<void> {
  const initial = rows.value.length === 0;
  if (initial) loading.value = true;
  else refreshing.value = true;
  error.value = '';
  try {
    rows.value = await api<XpRow[]>('/api/admin/xp');
  } catch {
    error.value = 'Die XP-Rangliste konnte gerade nicht geladen werden.';
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

function levelProgress(row: XpRow): number {
  const currentLevelXp = 100 * row.level ** 2;
  const nextLevelXp = 100 * (row.level + 1) ** 2;
  return Math.max(0, Math.min(100, ((row.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100));
}

function xpUntilNextLevel(row: XpRow): number {
  return Math.max(0, 100 * (row.level + 1) ** 2 - row.xp);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('de-DE').format(value);
}

async function copyUserId(row: XpRow): Promise<void> {
  try {
    await navigator.clipboard.writeText(row.userId);
    toast.success('Nutzer-ID kopiert', row.username);
  } catch {
    toast.info('Nutzer-ID', row.userId);
  }
}

onMounted(() => void load());
</script>

<template>
  <div>
    <PageHero
      :icon="Trophy"
      eyebrow="Community · Aktivität"
      title="XP-Rangliste"
      description="Die aktivsten Community-Mitglieder, ihre Level und der Fortschritt bis zum nächsten Meilenstein."
    >
      <div class="rounded-xl border border-line bg-surface-2/70 px-3 py-2 text-xs text-slate-400">
        <span class="font-semibold text-white">Top 50</span> · Live-Stand
      </div>
      <button class="btn-primary" :disabled="loading || refreshing" @click="load">
        <RefreshCw class="h-4 w-4" :class="loading || refreshing ? 'animate-spin' : ''" />
        Aktualisieren
      </button>
    </PageHero>

    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
          <Users class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ formatNumber(rows.length) }}</div>
          <div class="text-xs text-slate-500">Mitglieder im Ranking</div>
        </div>
      </div>
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
          <Zap class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ formatNumber(totalXp) }}</div>
          <div class="text-xs text-slate-500">XP gesammelt</div>
        </div>
      </div>
      <div class="metric-tile flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
          <MessageSquare class="h-5 w-5" />
        </div>
        <div>
          <div class="text-xl font-bold text-white">{{ formatNumber(totalMessages) }}</div>
          <div class="text-xs text-slate-500">Gewertete Nachrichten</div>
        </div>
      </div>
    </div>

    <div v-if="error" class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-300">
      <span>{{ error }}</span>
      <button class="btn-ghost btn-sm" @click="load">Erneut versuchen</button>
    </div>

    <div v-if="loading" class="mt-5">
      <div class="grid gap-4 md:grid-cols-3" aria-label="Rangliste wird geladen">
        <div v-for="i in 3" :key="i" class="skeleton h-64 rounded-[20px]" />
      </div>
      <div class="mt-4 skeleton h-52 rounded-[20px]" />
    </div>

    <EmptyState
      v-else-if="!error && rows.length === 0"
      class="mt-5"
      :icon="Trophy"
      title="Noch niemand auf dem Podium"
      description="Sobald Community-Mitglieder aktiv schreiben und XP erhalten, füllt sich die Rangliste automatisch."
    />

    <template v-else-if="rows.length > 0">
      <section class="mt-7" aria-labelledby="podium-heading">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Hall of Fame</div>
            <h2 id="podium-heading" class="mt-1 text-lg font-semibold text-white">Das aktuelle Podium</h2>
          </div>
          <Crown class="h-5 w-5 text-amber-300" />
        </div>

        <div class="grid gap-4" :class="topThree.length === 1 ? 'md:max-w-md' : topThree.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'">
          <article
            v-for="row in topThree"
            :key="row.userId"
            class="relative overflow-hidden rounded-[22px] border p-5 shadow-card"
            :class="row.rank === 1 ? 'border-amber-400/20 bg-gradient-to-br from-amber-400/[0.10] via-surface-1 to-violet-500/[0.08] md:-translate-y-1' : 'border-line bg-surface-1/90'"
          >
            <div v-if="row.rank === 1" class="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-amber-300/10 blur-3xl" />
            <div class="relative flex items-start justify-between">
              <div
                class="flex h-14 w-14 items-center justify-center rounded-2xl text-base font-bold text-white shadow-lg"
                :class="row.rank === 1 ? 'bg-gradient-to-br from-amber-300 to-orange-500' : row.rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500' : 'bg-gradient-to-br from-orange-400 to-amber-700'"
              >
                {{ initials(row.username) }}
              </div>
              <div
                class="inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold"
                :class="row.rank === 1 ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-line bg-surface-2 text-slate-300'"
              >
                <Crown v-if="row.rank === 1" class="h-4 w-4" />
                <Medal v-else class="h-4 w-4" />
                #{{ row.rank }}
              </div>
            </div>
            <h3 class="relative mt-5 truncate text-lg font-bold text-white">{{ row.username }}</h3>
            <div class="relative mt-1 flex items-center justify-between gap-3 text-xs">
              <span class="font-semibold text-violet-300">Level {{ row.level }}</span>
              <span class="text-slate-500">{{ formatNumber(row.xp) }} XP</span>
            </div>
            <div class="relative mt-4 progress-track">
              <div class="progress-fill transition-[width] duration-700" :style="{ width: `${levelProgress(row)}%` }" />
            </div>
            <div class="relative mt-2 flex items-center justify-between text-[11px] text-slate-600">
              <span>{{ formatNumber(row.messagesCounted) }} Nachrichten</span>
              <span>{{ formatNumber(xpUntilNextLevel(row)) }} XP bis Lv {{ row.level + 1 }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="mt-6 card-flush overflow-hidden" aria-labelledby="ranking-heading">
        <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="ranking-heading" class="font-semibold text-white">{{ query ? 'Suchergebnisse' : 'Weitere Platzierungen' }}</h2>
            <p class="mt-0.5 text-xs text-slate-500">Originalrang, Level und Fortschritt auf einen Blick.</p>
          </div>
          <label class="relative w-full sm:max-w-xs">
            <span class="sr-only">Mitglied suchen</span>
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input v-model="query" type="search" class="input py-2 pl-9" placeholder="Mitglied oder Discord-ID suchen …" />
          </label>
        </div>

        <div v-if="listRows.length === 0" class="px-5 py-10 text-center text-sm text-slate-500">
          {{ query ? 'Kein Mitglied passt zu deiner Suche.' : 'Noch keine weiteren Platzierungen.' }}
        </div>
        <div v-else>
          <article v-for="row in listRows" :key="row.userId" class="flex flex-col gap-4 border-b border-line px-4 py-4 last:border-0 hover:bg-surface-2/40 sm:flex-row sm:items-center">
            <div class="flex min-w-0 flex-1 items-center gap-3">
              <div class="w-7 shrink-0 text-center text-sm font-bold text-slate-500">#{{ row.rank }}</div>
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blurple/80 to-cyan-500/70 text-xs font-bold text-white">
                {{ initials(row.username) }}
              </div>
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-white">{{ row.username }}</div>
                <button class="mt-0.5 inline-flex max-w-full items-center gap-1 text-[11px] text-slate-600 transition hover:text-slate-400" title="Nutzer-ID kopieren" @click="copyUserId(row)">
                  <span class="mono truncate">{{ row.userId }}</span>
                  <Copy class="h-3 w-3 shrink-0" />
                </button>
              </div>
            </div>

            <div class="w-full sm:w-48 lg:w-64">
              <div class="mb-1.5 flex items-center justify-between text-[11px]">
                <span class="font-semibold text-violet-300">Level {{ row.level }}</span>
                <span class="text-slate-600">{{ Math.round(levelProgress(row)) }}%</span>
              </div>
              <div class="progress-track"><div class="progress-fill" :style="{ width: `${levelProgress(row)}%` }" /></div>
            </div>

            <div class="flex shrink-0 items-center justify-between gap-6 sm:w-36 sm:justify-end sm:text-right">
              <div>
                <div class="text-sm font-bold text-white">{{ formatNumber(row.xp) }} XP</div>
                <div class="text-[11px] text-slate-600">{{ formatNumber(row.messagesCounted) }} Nachrichten</div>
              </div>
            </div>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>
