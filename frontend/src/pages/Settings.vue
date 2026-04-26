<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Save, Star, Shield, UserPlus, Sparkles, MessageSquare, Ban } from 'lucide-vue-next';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';

const toast = useToast();

interface Settings {
  starboardThreshold: number;
  starboardEmoji: string;
  automodInviteFilter: boolean;
  automodCapsFilter: boolean;
  automodCapsThreshold: number;
  automodCapsMinLen: number;
  automodMentionSpam: boolean;
  automodMentionThreshold: number;
  automodExternalLinkFilter: boolean;
  automodBlockedPhrases: string;
  autoRoleId: string | null;
  aiModerationEnabled: boolean;
  aiModerationThreshold: number;
  welcomeDmTemplate: string;
}

interface Role {
  id: string;
  name: string;
  color: number;
}

const settings = ref<Settings | null>(null);
const roles = ref<Role[]>([]);
const loading = ref(true);
const saving = ref(false);
const welcomeDmPlaceholder = 'Hey {{username}}, willkommen auf {{server}}! …';

async function load(): Promise<void> {
  loading.value = true;
  const [s, g] = await Promise.all([
    api<Settings>('/api/admin/settings'),
    api<{ roles: Role[] }>('/api/admin/guild'),
  ]);
  settings.value = s;
  roles.value = g.roles;
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
    toast.success('Gespeichert', 'Die Settings sind sofort aktiv.');
  } catch {
    toast.error('Fehler beim Speichern', 'Check die Bot-Logs.');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">
          Runtime-Einstellungen. Änderungen greifen sofort — kein Container-Restart nötig.
        </p>
      </div>
    </div>

    <div v-if="loading" class="mt-8 text-slate-500">Lade…</div>

    <div v-else-if="settings" class="mt-6 space-y-4">
      <div class="card">
        <div class="flex items-center gap-3">
          <UserPlus class="h-5 w-5 text-green-400" />
          <h2 class="text-lg font-semibold text-white">Auto-Role on Join</h2>
        </div>
        <div class="mt-4">
          <label class="block text-xs font-medium text-slate-400">Rolle für neue Member</label>
          <select
            v-model="settings.autoRoleId"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
          >
            <option :value="null">— keine —</option>
            <option v-for="r in roles" :key="r.id" :value="r.id">@{{ r.name }}</option>
          </select>
          <p class="mt-1 text-xs text-slate-500">
            Wird jedem neuen Member bei Join automatisch zugewiesen. Bot-Rolle muss über der Ziel-Rolle stehen.
          </p>
        </div>
      </div>

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
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-400">Emoji</label>
            <input
              type="text"
              maxlength="32"
              v-model="settings.starboardEmoji"
              class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-3">
          <Shield class="h-5 w-5 text-red-400" />
          <h2 class="text-lg font-semibold text-white">Automod</h2>
        </div>
        <div class="mt-4 space-y-4">
          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.automodInviteFilter"
              class="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
            />
            <div>
              <div class="text-sm font-medium text-white">Invite-Filter</div>
              <div class="text-xs text-slate-500">Löscht Nachrichten mit Discord-Invites.</div>
            </div>
          </label>

          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.automodMentionSpam"
              class="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
            />
            <div class="flex-1">
              <div class="text-sm font-medium text-white">Mention-Spam-Filter</div>
              <div class="text-xs text-slate-500">Löscht Nachrichten mit zu vielen Mentions.</div>
              <div class="mt-2 flex items-center gap-2 text-xs">
                <span class="text-slate-400">Ab:</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  v-model.number="settings.automodMentionThreshold"
                  class="w-20 rounded border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-none"
                />
                <span class="text-slate-400">Mentions (@everyone zählt als 5)</span>
              </div>
            </div>
          </label>

          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.automodCapsFilter"
              class="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
            />
            <div class="flex-1">
              <div class="text-sm font-medium text-white">Caps-Filter</div>
              <div class="text-xs text-slate-500">Löscht Shouting.</div>
              <div class="mt-2 flex items-center gap-2 text-xs">
                <span class="text-slate-400">Ab:</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  v-model.number="settings.automodCapsThreshold"
                  class="w-20 rounded border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-none"
                />
                <span class="text-slate-400">% Großbuchstaben, Min-Länge:</span>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  v-model.number="settings.automodCapsMinLen"
                  class="w-20 rounded border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-none"
                />
                <span class="text-slate-400">Zeichen</span>
              </div>
            </div>
          </label>

          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.automodExternalLinkFilter"
              class="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
            />
            <div>
              <div class="text-sm font-medium text-white">Externe-Link-Filter</div>
              <div class="text-xs text-slate-500">Löscht Nachrichten mit Links außerhalb Discord-Domains.</div>
            </div>
          </label>

          <div class="flex items-start gap-3">
            <Ban class="mt-0.5 h-4 w-4 text-slate-400" />
            <div class="flex-1">
              <div class="text-sm font-medium text-white">Blockierte Phrasen</div>
              <div class="text-xs text-slate-500">
                Eine Phrase pro Zeile (oder Komma-separiert). Substring-Match, case-insensitive. Min. 2 Zeichen.
              </div>
              <textarea
                v-model="settings.automodBlockedPhrases"
                rows="4"
                placeholder="badword&#10;another phrase&#10;n-word"
                class="mt-2 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blurple focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-3">
          <MessageSquare class="h-5 w-5 text-cyan-400" />
          <h2 class="text-lg font-semibold text-white">Welcome-DM Template</h2>
        </div>
        <div class="mt-4">
          <p class="text-xs text-slate-500">
            Wird neuen Mitgliedern als private DM geschickt. Leer lassen → Default-Text.
            Verfügbare Platzhalter:
            <code v-text="'{{username}}'" />,
            <code v-text="'{{mention}}'" />,
            <code v-text="'{{server}}'" />,
            <code v-text="'{{memberCount}}'" />.
            Markdown ist erlaubt.
          </p>
          <textarea
            v-model="settings.welcomeDmTemplate"
            rows="8"
            :placeholder="welcomeDmPlaceholder"
            class="mt-2 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blurple focus:outline-none"
          />
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-3">
          <Sparkles class="h-5 w-5 text-violet-400" />
          <h2 class="text-lg font-semibold text-white">AI-Moderation</h2>
        </div>
        <div class="mt-4 space-y-4">
          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.aiModerationEnabled"
              class="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
            />
            <div class="flex-1">
              <div class="text-sm font-medium text-white">OpenAI Moderation aktiv</div>
              <div class="text-xs text-slate-500">
                Prüft Nachrichten auf Hate/Harassment/Violence via OpenAI Moderation API (kostenlos, keine Tokens verbraucht).
                Braucht <code>OPENAI_API_KEY</code> im Container. Staff/Mods werden umgangen. Nur Text &gt; 8 Zeichen.
              </div>
              <div class="mt-2 flex items-center gap-2 text-xs">
                <span class="text-slate-400">Score-Threshold:</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  v-model.number="settings.aiModerationThreshold"
                  class="w-20 rounded border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-none"
                />
                <span class="text-slate-400">(0.0-1.0, default 0.7 = streng. Niedriger = aggressiver.)</span>
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
      </div>
    </div>
  </div>
</template>
