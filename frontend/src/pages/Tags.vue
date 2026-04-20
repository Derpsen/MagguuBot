<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Plus, Trash2, Edit3 } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Tag {
  name: string;
  response: string;
  uses: number;
  createdBy: string;
  updatedAt: string;
}

const rows = ref<Tag[]>([]);
const loading = ref(true);
const editing = ref<Tag | null>(null);
const formName = ref('');
const formResponse = ref('');

async function load(): Promise<void> {
  loading.value = true;
  rows.value = await api<Tag[]>('/api/admin/tags');
  loading.value = false;
}

function startEdit(tag: Tag): void {
  editing.value = tag;
  formName.value = tag.name;
  formResponse.value = tag.response;
}

function startNew(): void {
  editing.value = { name: '', response: '', uses: 0, createdBy: '', updatedAt: '' };
  formName.value = '';
  formResponse.value = '';
}

function cancel(): void {
  editing.value = null;
}

async function save(): Promise<void> {
  if (!formName.value || !formResponse.value) return;
  await api('/api/admin/tags', {
    method: 'POST',
    body: JSON.stringify({ name: formName.value.toLowerCase(), response: formResponse.value }),
  });
  editing.value = null;
  await load();
}

async function del(name: string): Promise<void> {
  if (!confirm(`Tag "${name}" löschen?`)) return;
  await api(`/api/admin/tags/${name}`, { method: 'DELETE' });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-white">Tags (Custom Commands)</h1>
        <p class="mt-1 text-sm text-slate-400">
          FAQ-Antworten die User mit <code>/tag get name:...</code> abrufen.
        </p>
      </div>
      <button class="btn-primary" @click="startNew">
        <Plus class="h-4 w-4" />
        Neuer Tag
      </button>
    </div>

    <div v-if="editing" class="mt-6 card">
      <h2 class="text-lg font-semibold text-white">
        {{ editing.createdBy ? `Bearbeiten: ${editing.name}` : 'Neuer Tag' }}
      </h2>
      <div class="mt-4 space-y-3">
        <div>
          <label class="block text-xs font-medium text-slate-400">Name (a-z, 0-9, -)</label>
          <input
            type="text"
            v-model="formName"
            :disabled="!!editing.createdBy"
            maxlength="30"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none disabled:opacity-50"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-400">Response (max 2000 chars)</label>
          <textarea
            v-model="formResponse"
            rows="5"
            maxlength="2000"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
          ></textarea>
        </div>
        <div class="flex gap-2">
          <button class="btn-primary" @click="save">Speichern</button>
          <button class="btn-ghost" @click="cancel">Abbrechen</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else class="mt-6 card p-0">
      <div v-if="rows.length === 0" class="p-8 text-center text-slate-500">
        Noch keine Tags. Klick oben auf "Neuer Tag".
      </div>
      <div v-else>
        <div v-for="t in rows" :key="t.name" class="table-row">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <code class="rounded bg-slate-800 px-2 py-0.5 text-sm font-semibold text-white">{{ t.name }}</code>
              <span class="text-xs text-slate-500">{{ t.uses }} uses</span>
            </div>
            <div class="mt-1 truncate text-sm text-slate-300">{{ t.response }}</div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-ghost" @click="startEdit(t)">
              <Edit3 class="h-3.5 w-3.5" />
            </button>
            <button class="btn-danger" @click="del(t.name)">
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
