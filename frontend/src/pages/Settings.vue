<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Save, Star, Shield } from 'lucide-vue-next';
import { api } from '../lib/api';

interface Settings {
  starboardThreshold: number;
  starboardEmoji: string;
  automodInviteFilter: boolean;
}

const settings = ref<Settings | null>(null);
const loading = ref(true);
const saving = ref(false);
const toast = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  settings.value = await api<Settings>('/api/admin/settings');
  loading.value = false;
}

async function save(): Promise<void> {
  if (!settings.value) return;
  saving.value = true;
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings.value),
    });
    toast.value = 'Gespeichert.';
    setTimeout(() => (toast.value = null), 2500);
  } catch {
    toast.value = 'Fehler beim Speichern.';
    setTimeout(() => (toast.value = null), 2500);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-white">Settings</h1>
    <p class="mt-1 text-sm text-slate-400">
      Runtime-Einstellungen. Änderungen greifen sofort — kein Container-Restart nötig.
    </p>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else-if="settings" class="mt-6 space-y-4">
      <div class="card">
        <div class="flex items-center gap-3">
          <Star class="h-5 w-5 text-yellow-400" />
          <h2 class="text-lg font-semibold text-white">Starboard</h2>
        </div>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label class="block text-xs font-medium text-slate-400">Threshold</label>
            <input
              type="number"
              min="1"
              max="100"
              v-model.number="settings.starboardThreshold"
              class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
            />
            <p class="mt-1 text-xs text-slate-500">Anzahl ⭐-Reactions bis ein Post ins Starboard kommt.</p>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-400">Emoji</label>
            <input
              type="text"
              maxlength="32"
              v-model="settings.starboardEmoji"
              class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
            />
            <p class="mt-1 text-xs text-slate-500">Unicode-Emoji oder Custom-Emoji-ID (zahlen).</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-3">
          <Shield class="h-5 w-5 text-red-400" />
          <h2 class="text-lg font-semibold text-white">Automod</h2>
        </div>
        <div class="mt-4">
          <label class="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              v-model="settings.automodInviteFilter"
              class="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
            />
            <div>
              <div class="text-sm font-medium text-white">Discord-Invite-Filter</div>
              <div class="text-xs text-slate-500">
                Löscht Nachrichten mit <code>discord.gg/...</code> / <code>discord.com/invite/...</code>.
                Mods (Manage Messages) + Admins sind ausgenommen.
              </div>
            </div>
          </label>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button class="btn-primary" :disabled="saving" @click="save">
          <Save class="h-4 w-4" />
          {{ saving ? 'Speichere…' : 'Speichern' }}
        </button>
        <span v-if="toast" class="text-sm text-green-400">{{ toast }}</span>
      </div>
    </div>
  </div>
</template>
