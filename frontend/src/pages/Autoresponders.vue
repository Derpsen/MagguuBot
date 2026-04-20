<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Plus, Trash2, Power } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Autoresponder {
  id: number;
  pattern: string;
  response: string;
  matchType: 'substring' | 'word' | 'regex';
  enabled: boolean;
  createdAt: string;
}

const rows = ref<Autoresponder[]>([]);
const loading = ref(true);
const creating = ref(false);
const formPattern = ref('');
const formResponse = ref('');
const formMatch = ref<'substring' | 'word' | 'regex'>('substring');

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<Autoresponder[]>('/api/admin/autoresponders');
  loading.value = false;
}

async function create(): Promise<void> {
  if (!formPattern.value || !formResponse.value) return;
  await api('/api/admin/autoresponders', {
    method: 'POST',
    body: JSON.stringify({
      pattern: formPattern.value,
      response: formResponse.value,
      matchType: formMatch.value,
    }),
  });
  creating.value = false;
  formPattern.value = '';
  formResponse.value = '';
  formMatch.value = 'substring';
  await load();
}

async function toggle(r: Autoresponder): Promise<void> {
  await api(`/api/admin/autoresponders/${r.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: !r.enabled }),
  });
  await load();
}

async function del(id: number): Promise<void> {
  if (!confirm('Autoresponder löschen?')) return;
  await api(`/api/admin/autoresponders/${id}`, { method: 'DELETE' });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-white">Autoresponder</h1>
        <p class="mt-1 text-sm text-slate-400">
          Pattern-Trigger → Auto-Reply. Substring / ganzes Wort / Regex.
        </p>
      </div>
      <button class="btn-primary" @click="creating = !creating">
        <Plus class="h-4 w-4" />
        Neu
      </button>
    </div>

    <div v-if="creating" class="mt-6 card">
      <h2 class="text-lg font-semibold text-white">Neuer Autoresponder</h2>
      <div class="mt-4 space-y-3">
        <div>
          <label class="block text-xs font-medium text-slate-400">Match-Type</label>
          <select
            v-model="formMatch"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
          >
            <option value="substring">substring — findet Text irgendwo</option>
            <option value="word">word — nur als ganzes Wort</option>
            <option value="regex">regex — regulärer Ausdruck</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-400">Pattern</label>
          <input
            type="text"
            v-model="formPattern"
            maxlength="200"
            placeholder="z.B. hilfe brauche   oder   \\bdanke\\b"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-400">Response</label>
          <textarea
            v-model="formResponse"
            rows="3"
            maxlength="1500"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
          ></textarea>
        </div>
        <div class="flex gap-2">
          <button class="btn-primary" @click="create">Anlegen</button>
          <button class="btn-ghost" @click="creating = false">Abbrechen</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Autoresponder.
      </div>
      <div v-else>
        <div v-for="r in rows" :key="r.id" class="table-row">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{{ r.matchType }}</code>
              <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">{{ r.pattern }}</code>
              <span v-if="r.enabled" class="text-xs text-green-400">🟢 aktiv</span>
              <span v-else class="text-xs text-slate-500">⚪ aus</span>
            </div>
            <div class="mt-1 truncate text-sm text-slate-300">→ {{ r.response }}</div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-ghost" @click="toggle(r)">
              <Power class="h-3.5 w-3.5" />
            </button>
            <button class="btn-danger" @click="del(r.id)">
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
