<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Plus, Trash2, Power, Pencil, MessageSquareText, Regex, Type, Hash, X, Sparkles, Timer, Palette, Copy, Check, Bot } from 'lucide-vue-next';
import { api } from '../lib/api';

type MatchType = 'substring' | 'word' | 'regex';

interface Autoresponder {
  id: number;
  pattern: string;
  response: string;
  matchType: MatchType;
  enabled: boolean;
  autoDeleteSeconds: number | null;
  asEmbed: boolean;
  createdAt: string;
}

const rows = ref<Autoresponder[]>([]);
const loading = ref(true);
const formOpen = ref(false);
const editingId = ref<number | null>(null);
const formPattern = ref('');
const formResponse = ref('');
const formMatch = ref<MatchType>('substring');
const formAutoDelete = ref(0);
const formAsEmbed = ref(false);
const formError = ref<string | null>(null);
const copiedId = ref<number | null>(null);

async function copyResponse(r: Autoresponder): Promise<void> {
  try {
    await navigator.clipboard.writeText(r.response);
    copiedId.value = r.id;
    setTimeout(() => {
      if (copiedId.value === r.id) copiedId.value = null;
    }, 1500);
  } catch {
    // clipboard blocked (e.g. http) — silent fail
  }
}
const saving = ref(false);

const PATTERN_MAX = 200;
const RESPONSE_MAX = 1500;

const AUTO_DELETE_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: 'Aus' },
  { value: 10, label: '10 Sek' },
  { value: 30, label: '30 Sek' },
  { value: 60, label: '1 Min' },
  { value: 300, label: '5 Min' },
];

function formatAutoDelete(seconds: number | null): string {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min`;
  return `${Math.round(seconds / 3600)} Std`;
}

const MATCH_META: Record<MatchType, { label: string; hint: string; badge: string; icon: typeof Hash }> = {
  substring: {
    label: 'Substring',
    hint: 'findet den Text irgendwo',
    badge: 'bg-slate-500/15 text-slate-300',
    icon: Hash,
  },
  word: {
    label: 'Ganzes Wort',
    hint: 'nur als isoliertes Token (whitespace/punct drumherum)',
    badge: 'bg-blurple-soft text-blurple',
    icon: Type,
  },
  regex: {
    label: 'Regex',
    hint: 'regulärer Ausdruck (case-insensitive)',
    badge: 'bg-amber-500/15 text-amber-400',
    icon: Regex,
  },
};

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<Autoresponder[]>('/api/admin/autoresponders');
  loading.value = false;
}

function resetForm(): void {
  formOpen.value = false;
  editingId.value = null;
  formPattern.value = '';
  formResponse.value = '';
  formMatch.value = 'substring';
  formAutoDelete.value = 0;
  formAsEmbed.value = false;
  formError.value = null;
}

function openCreate(): void {
  resetForm();
  formOpen.value = true;
}

function openEdit(r: Autoresponder): void {
  editingId.value = r.id;
  formPattern.value = r.pattern;
  formResponse.value = r.response;
  formMatch.value = r.matchType;
  formAutoDelete.value = r.autoDeleteSeconds ?? 0;
  formAsEmbed.value = r.asEmbed;
  formError.value = null;
  formOpen.value = true;
}

const regexValid = computed(() => {
  if (formMatch.value !== 'regex' || !formPattern.value) return true;
  try {
    new RegExp(formPattern.value, 'i');
    return true;
  } catch {
    return false;
  }
});

const formValid = computed(
  () => formPattern.value.trim().length > 0 && formResponse.value.trim().length > 0 && regexValid.value,
);

async function save(): Promise<void> {
  if (!formValid.value) return;
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      pattern: formPattern.value.trim(),
      response: formResponse.value.trim(),
      matchType: formMatch.value,
      autoDeleteSeconds: formAutoDelete.value > 0 ? formAutoDelete.value : null,
      asEmbed: formAsEmbed.value,
    };
    if (editingId.value === null) {
      await api('/api/admin/autoresponders', { method: 'POST', body: JSON.stringify(payload) });
    } else {
      await api(`/api/admin/autoresponders/${editingId.value}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    }
    resetForm();
    await load();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Speichern fehlgeschlagen';
  } finally {
    saving.value = false;
  }
}

async function toggle(r: Autoresponder): Promise<void> {
  await api(`/api/admin/autoresponders/${r.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: !r.enabled }),
  });
  await load();
}

async function del(r: Autoresponder): Promise<void> {
  if (!confirm(`Autoresponder "${r.pattern}" löschen?`)) return;
  await api(`/api/admin/autoresponders/${r.id}`, { method: 'DELETE' });
  await load();
}

function relativeTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'gerade eben';
  if (diffSec < 3600) return `vor ${Math.floor(diffSec / 60)} Min`;
  if (diffSec < 86400) return `vor ${Math.floor(diffSec / 3600)} Std`;
  return `vor ${Math.floor(diffSec / 86400)} Tagen`;
}

onMounted(load);
</script>

<template>
  <div class="page-fade">
    <div class="page-header">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blurple-soft text-blurple">
          <MessageSquareText class="h-5 w-5" />
        </div>
        <div>
          <h1 class="page-title">Autoresponder</h1>
          <p class="page-subtitle">
            Wenn eine Nachricht das Pattern trifft, antwortet der Bot automatisch.
          </p>
        </div>
      </div>
      <button class="btn-primary" @click="openCreate">
        <Plus class="h-4 w-4" />
        Neu
      </button>
    </div>

    <div v-if="formOpen" class="mt-6 card">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">
          {{ editingId === null ? 'Neuer Autoresponder' : `Bearbeiten #${editingId}` }}
        </h2>
        <button class="btn-icon" aria-label="Schließen" @click="resetForm">
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-5 space-y-5">
        <!-- Match-Type Segmented Control -->
        <div>
          <label class="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Match-Type
          </label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="(meta, key) in MATCH_META"
              :key="key"
              type="button"
              class="group flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-all"
              :class="
                formMatch === key
                  ? 'border-blurple bg-blurple-soft text-white'
                  : 'border-line-strong bg-surface-2 text-slate-300 hover:border-line-strong hover:bg-surface-3'
              "
              @click="formMatch = key"
            >
              <div class="flex items-center gap-1.5 text-sm font-medium">
                <component :is="meta.icon" class="h-3.5 w-3.5" />
                {{ meta.label }}
              </div>
              <span class="text-[11px] text-slate-400 group-hover:text-slate-300">{{ meta.hint }}</span>
            </button>
          </div>
        </div>

        <!-- Pattern -->
        <div>
          <div class="mb-2 flex items-end justify-between">
            <label class="text-xs font-semibold uppercase tracking-wider text-slate-500">Pattern</label>
            <span class="text-[11px] text-slate-500">
              {{ formPattern.length }} / {{ PATTERN_MAX }}
            </span>
          </div>
          <input
            v-model="formPattern"
            type="text"
            class="input font-mono"
            :class="{ '!border-red-500 focus:!border-red-500': formMatch === 'regex' && !regexValid && formPattern }"
            :maxlength="PATTERN_MAX"
            :placeholder="
              formMatch === 'regex'
                ? '\\b(danke|thx)\\b'
                : formMatch === 'word'
                ? '!dh'
                : 'hilfe brauche'
            "
          />
          <p v-if="formMatch === 'regex' && !regexValid && formPattern" class="mt-1.5 text-xs text-red-400">
            ⚠️ Ungültiges Regex-Pattern
          </p>
        </div>

        <!-- Response -->
        <div>
          <div class="mb-2 flex items-end justify-between">
            <label class="text-xs font-semibold uppercase tracking-wider text-slate-500">Antwort</label>
            <span class="text-[11px] text-slate-500">
              {{ formResponse.length }} / {{ RESPONSE_MAX }}
            </span>
          </div>
          <textarea
            v-model="formResponse"
            rows="4"
            :maxlength="RESPONSE_MAX"
            placeholder="Der Bot antwortet mit diesem Text. Discord-Markdown funktioniert."
            class="input resize-y"
          />
        </div>

        <!-- As Embed -->
        <div>
          <label class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Palette class="h-3 w-3" />
            Darstellung
          </label>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors"
              :class="
                !formAsEmbed
                  ? 'border-blurple bg-blurple-soft text-white'
                  : 'border-line-strong bg-surface-2 text-slate-300 hover:bg-surface-3'
              "
              @click="formAsEmbed = false"
            >
              <div class="text-sm font-medium">Plain Text</div>
              <div class="text-[11px] text-slate-400">normale Chat-Antwort</div>
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors"
              :class="
                formAsEmbed
                  ? 'border-blurple bg-blurple-soft text-white'
                  : 'border-line-strong bg-surface-2 text-slate-300 hover:bg-surface-3'
              "
              @click="formAsEmbed = true"
            >
              <div class="text-sm font-medium">Embed</div>
              <div class="text-[11px] text-slate-400">farbiges Karten-Design mit Footer</div>
            </button>
          </div>
          <div v-if="formAsEmbed" class="mt-3">
            <p class="mb-2 text-[11px] uppercase tracking-wider text-slate-500">Vorschau</p>
            <div class="flex items-start gap-2 rounded-lg bg-[#2b2d31] p-3">
              <div class="h-10 w-1 shrink-0 rounded-full bg-blurple" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <div class="flex h-5 w-5 items-center justify-center rounded-full bg-blurple text-white">
                    <Bot class="h-3 w-3" />
                  </div>
                  <span class="text-xs font-semibold text-white">MagguuBot</span>
                </div>
                <p class="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-100">
                  {{ formResponse || 'Dein Text erscheint hier.' }}
                </p>
                <p class="mt-2 text-[11px] text-slate-500">heute um {{ new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Auto-Delete -->
        <div>
          <label class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Timer class="h-3 w-3" />
            Auto-Löschen (Reply + Trigger-Nachricht)
          </label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in AUTO_DELETE_PRESETS"
              :key="preset.value"
              type="button"
              class="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                formAutoDelete === preset.value
                  ? 'border-blurple bg-blurple-soft text-white'
                  : 'border-line-strong bg-surface-2 text-slate-400 hover:bg-surface-3 hover:text-slate-200'
              "
              @click="formAutoDelete = preset.value"
            >
              {{ preset.label }}
            </button>
          </div>
          <p v-if="formAutoDelete > 0" class="mt-2 text-[11px] text-slate-500">
            Nach {{ formatAutoDelete(formAutoDelete) }} werden Bot-Antwort und die Trigger-Nachricht gelöscht.
          </p>
        </div>

        <p v-if="formError" class="text-sm text-red-400">{{ formError }}</p>

        <div class="flex items-center justify-end gap-2 border-t border-line pt-4">
          <button class="btn-ghost" :disabled="saving" @click="resetForm">Abbrechen</button>
          <button class="btn-primary" :disabled="!formValid || saving" @click="save">
            <Sparkles class="h-4 w-4" />
            {{ saving ? 'Speichere…' : editingId === null ? 'Anlegen' : 'Änderungen speichern' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="mt-6 space-y-3">
      <div v-for="i in 3" :key="i" class="skeleton h-20 rounded-2xl" />
    </div>

    <!-- Empty state -->
    <div v-else-if="rows.length === 0" class="mt-6 card flex flex-col items-center gap-3 py-14 text-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-slate-400">
        <MessageSquareText class="h-6 w-6" />
      </div>
      <div>
        <p class="font-medium text-white">Noch keine Autoresponder angelegt</p>
        <p class="mt-1 text-sm text-slate-400">
          Leg einen an — der Bot antwortet automatisch wenn eine Nachricht matcht.
        </p>
      </div>
      <button class="btn-primary mt-2" @click="openCreate">
        <Plus class="h-4 w-4" />
        Ersten Autoresponder anlegen
      </button>
    </div>

    <!-- List -->
    <div v-else class="mt-6 space-y-3">
      <div
        v-for="r in rows"
        :key="r.id"
        class="card group relative p-0 transition-all"
        :class="!r.enabled && 'opacity-70'"
      >
        <div class="flex items-start gap-4 p-4">
          <!-- Match-Type icon -->
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-medium"
            :class="MATCH_META[r.matchType].badge"
          >
            <component :is="MATCH_META[r.matchType].icon" class="h-4 w-4" />
          </div>

          <!-- Content -->
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <code
                class="mono rounded-md bg-surface-2 px-2 py-0.5 text-sm font-medium text-white"
              >{{ r.pattern }}</code>
              <span class="badge" :class="MATCH_META[r.matchType].badge">
                {{ MATCH_META[r.matchType].label }}
              </span>
              <span v-if="r.enabled" class="badge-success">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                aktiv
              </span>
              <span v-else class="badge-muted">
                <span class="h-1.5 w-1.5 rounded-full bg-slate-500" />
                pausiert
              </span>
              <span v-if="r.autoDeleteSeconds" class="badge bg-amber-500/15 text-amber-400" :title="`Antwort und Trigger werden nach ${formatAutoDelete(r.autoDeleteSeconds)} gelöscht`">
                <Timer class="h-3 w-3" />
                {{ formatAutoDelete(r.autoDeleteSeconds) }}
              </span>
              <span v-if="r.asEmbed" class="badge bg-violet-500/15 text-violet-300" title="Als Embed gepostet">
                <Palette class="h-3 w-3" />
                Embed
              </span>
              <span class="ml-auto text-[11px] text-slate-500" :title="new Date(r.createdAt).toLocaleString()">
                {{ relativeTime(r.createdAt) }}
              </span>
            </div>

            <div class="relative mt-2">
              <button
                class="absolute top-1.5 right-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-3/80 text-slate-400 opacity-0 transition-all hover:bg-surface-3 hover:text-white group-hover:opacity-100"
                :title="copiedId === r.id ? 'Kopiert!' : 'Response kopieren'"
                @click="copyResponse(r)"
              >
                <Check v-if="copiedId === r.id" class="h-3.5 w-3.5 text-emerald-400" />
                <Copy v-else class="h-3.5 w-3.5" />
              </button>

              <!-- Embed mode: Discord-style card -->
              <div v-if="r.asEmbed" class="flex items-start gap-2 rounded-lg bg-[#2b2d31] p-3 pr-10">
                <div class="h-auto w-1 shrink-0 self-stretch rounded-full bg-blurple" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <div class="flex h-5 w-5 items-center justify-center rounded-full bg-blurple text-white">
                      <Bot class="h-3 w-3" />
                    </div>
                    <span class="text-xs font-semibold text-white">MagguuBot</span>
                  </div>
                  <p class="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-100">{{ r.response }}</p>
                </div>
              </div>

              <!-- Plain mode -->
              <div v-else class="flex gap-2 rounded-lg border border-line bg-surface-2/50 px-3 py-2 pr-10">
                <span class="shrink-0 text-slate-500">→</span>
                <p class="whitespace-pre-wrap break-words text-sm text-slate-200">{{ r.response }}</p>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
            <button
              class="btn-icon"
              :title="r.enabled ? 'Pausieren' : 'Aktivieren'"
              @click="toggle(r)"
            >
              <Power class="h-4 w-4" :class="r.enabled ? 'text-emerald-400' : 'text-slate-500'" />
            </button>
            <button class="btn-icon" title="Bearbeiten" @click="openEdit(r)">
              <Pencil class="h-4 w-4" />
            </button>
            <button
              class="btn-icon hover:!bg-red-500/15 hover:!text-red-400"
              title="Löschen"
              @click="del(r)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
