<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Star,
  UserPlus,
} from '@lucide/vue';
import { api } from '../lib/api';
import { useToast } from '../composables/useToast';
import ConfirmDialog from '../components/ConfirmDialog.vue';

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
  assignable: boolean;
  assignmentIssue: string | null;
}

interface AutoRoleStatus {
  roleId: string | null;
  roleName: string | null;
  source: 'configured' | 'newcomer-fallback' | 'none';
  assignable: boolean;
  issue: string | null;
  warning?: string | null;
  botHighestRoleName: string | null;
  canManageRoles: boolean;
}

interface GuildInfo {
  roles: Role[];
  autoRole: AutoRoleStatus;
}

interface ReconcileResult {
  ok: boolean;
  role: unknown;
  examined: number;
  candidates: number;
  assigned: number;
  failed: number;
  truncated: boolean;
  windowDays: number;
}

interface AutoRolePreview {
  roleName: string | null;
  assignable: boolean;
  issue: string | null;
}

const settings = ref<Settings | null>(null);
const roles = ref<Role[]>([]);
const guildInfo = ref<GuildInfo | null>(null);
const savedAutoRoleId = ref<string | null>(null);
const loading = ref(true);
const saving = ref(false);
const savingAutoRole = ref(false);
const reconciling = ref(false);
const confirmReconcile = ref(false);
const welcomeDmPlaceholder = 'Hey {{username}}, willkommen auf {{server}}! …';

const autoRoleDirty = computed(() => settings.value?.autoRoleId !== savedAutoRoleId.value);

const autoRolePreview = computed<AutoRolePreview | null>(() => {
  if (!settings.value) return null;

  if (!autoRoleDirty.value && guildInfo.value?.autoRole) {
    const status = guildInfo.value.autoRole;
    return {
      roleName: status.roleName,
      assignable: status.assignable,
      issue: status.issue,
    };
  }

  const selectedRole = settings.value.autoRoleId
    ? roles.value.find((role) => role.id === settings.value?.autoRoleId)
    : roles.value.find((role) => role.name.toLocaleLowerCase() === 'newcomer');

  if (!selectedRole) {
    return {
      roleName: null,
      assignable: false,
      issue: settings.value.autoRoleId
        ? 'Die gewählte Rolle ist auf dem Server nicht mehr vorhanden.'
        : 'Die Standard-Rolle @Newcomer wurde auf dem Server nicht gefunden.',
    };
  }

  return {
    roleName: selectedRole.name,
    assignable: selectedRole.assignable,
    issue: selectedRole.assignmentIssue,
  };
});

const canReconcile = computed(
  () => !autoRoleDirty.value && autoRolePreview.value?.assignable === true,
);

async function loadGuild(): Promise<void> {
  const guild = await api<GuildInfo>('/api/admin/guild');
  guildInfo.value = guild;
  roles.value = guild.roles;
}

async function refreshGuildStatus(): Promise<boolean> {
  try {
    await loadGuild();
    return true;
  } catch {
    // Never leave a stale role as actionable after the setting was saved.
    guildInfo.value = null;
    roles.value = [];
    return false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  const [s, g] = await Promise.all([
    api<Settings>('/api/admin/settings'),
    api<GuildInfo>('/api/admin/guild'),
  ]);
  settings.value = s;
  savedAutoRoleId.value = s.autoRoleId;
  guildInfo.value = g;
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
    savedAutoRoleId.value = settings.value.autoRoleId;
    const roleStatusFresh = await refreshGuildStatus();
    toast.success(
      'Gespeichert',
      roleStatusFresh
        ? 'Die Einstellungen sind sofort aktiv.'
        : 'Die Einstellungen sind aktiv; der Discord-Rollenstatus konnte noch nicht neu geladen werden.',
    );
  } catch (error) {
    toast.error('Fehler beim Speichern', errorMessage(error, 'Prüfe die Bot-Logs.'));
  } finally {
    saving.value = false;
  }
}

async function saveAutoRole(): Promise<void> {
  if (!settings.value || !autoRolePreview.value?.assignable) return;
  savingAutoRole.value = true;
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ autoRoleId: settings.value.autoRoleId }),
    });
    savedAutoRoleId.value = settings.value.autoRoleId;
    const roleStatusFresh = await refreshGuildStatus();
    toast.success(
      'Startrolle gespeichert',
      roleStatusFresh
        ? settings.value.autoRoleId
          ? `@${autoRolePreview.value?.roleName ?? 'Rolle'} wird neuen Mitgliedern zugewiesen.`
          : 'Der Bot verwendet automatisch die Rolle @Newcomer.'
        : 'Die Auswahl ist aktiv; der Discord-Rollenstatus konnte noch nicht neu geladen werden.',
    );
  } catch (error) {
    toast.error('Startrolle nicht gespeichert', errorMessage(error, 'Die Rolle konnte nicht geprüft werden.'));
  } finally {
    savingAutoRole.value = false;
  }
}

async function reconcileAutoRole(): Promise<void> {
  if (!canReconcile.value) return;
  reconciling.value = true;
  try {
    const result = await api<ReconcileResult>('/api/admin/auto-role/reconcile', { method: 'POST' });
    const summary = `${result.examined} Mitglieder geprüft, ${result.candidates} passende Beitritte der letzten ${result.windowDays} Tage gefunden.`;
    const failures = result.failed > 0 ? ` ${result.failed} Zuweisungen sind fehlgeschlagen.` : '';
    const limit = result.truncated ? ' Es gibt weitere mögliche Kandidaten; der Lauf war begrenzt.' : '';

    if (result.assigned > 0) {
      toast.success(
        'Startrollen nachgetragen',
        `${result.assigned} ${result.assigned === 1 ? 'Rolle wurde' : 'Rollen wurden'} vergeben. ${summary}${failures}${limit}`,
      );
    } else {
      toast.info('Keine Rolle nachzutragen', `${summary}${failures}${limit}`);
    }
    confirmReconcile.value = false;
    if (!await refreshGuildStatus()) {
      toast.warn('Status nicht aktualisiert', 'Die Rollen wurden verarbeitet, aber die Discord-Diagnose konnte nicht neu geladen werden.');
    }
  } catch (error) {
    toast.error('Nachtragen fehlgeschlagen', errorMessage(error, 'Die Startrollen konnten nicht nachgetragen werden.'));
  } finally {
    reconciling.value = false;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">Einstellungen</h1>
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
          <div>
            <h2 class="text-lg font-semibold text-white">Startrolle</h2>
            <p class="text-xs text-slate-500">Automatische Rolle für neue Discord-Mitglieder</p>
          </div>
        </div>
        <div class="mt-4 space-y-4">
          <div>
          <label class="block text-xs font-medium text-slate-400">Rolle für neue Member</label>
          <select
            v-model="settings.autoRoleId"
            class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-hidden"
          >
              <option :value="null">Standard (@Newcomer)</option>
              <option
                v-for="r in roles"
                :key="r.id"
                :value="r.id"
                :disabled="!r.assignable"
              >
                @{{ r.name }}{{ r.assignable ? '' : ' — nicht zuweisbar' }}
              </option>
          </select>
          <p class="mt-1 text-xs text-slate-500">
              „Standard“ sucht automatisch nach einer Rolle mit dem Namen <span class="font-medium text-slate-400">@Newcomer</span>.
          </p>
          </div>

          <div
            v-if="autoRolePreview"
            class="rounded-xl border px-4 py-3"
            :class="autoRolePreview.assignable
              ? 'border-emerald-400/20 bg-emerald-400/8'
              : 'border-amber-400/20 bg-amber-400/8'"
          >
            <div class="flex items-start gap-3">
              <CheckCircle2 v-if="autoRolePreview.assignable" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <AlertTriangle v-else class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div class="min-w-0">
                <p
                  class="text-sm font-medium"
                  :class="autoRolePreview.assignable ? 'text-emerald-200' : 'text-amber-200'"
                >
                  <template v-if="autoRolePreview.assignable">
                    Bereit: @{{ autoRolePreview.roleName }} kann vergeben werden.
                  </template>
                  <template v-else>Startrolle noch nicht einsatzbereit</template>
                </p>
                <p v-if="autoRolePreview.issue" class="mt-1 text-xs leading-relaxed text-slate-400">
                  {{ autoRolePreview.issue }}
                </p>
                <p v-if="!autoRoleDirty && guildInfo?.autoRole.warning" class="mt-1 text-xs leading-relaxed text-amber-300">
                  {{ guildInfo.autoRole.warning }}
                </p>
                <p v-if="autoRoleDirty" class="mt-1 text-xs font-medium text-amber-300">
                  Diese Auswahl ist noch nicht gespeichert.
                </p>
                <p v-if="guildInfo?.autoRole" class="mt-1 text-[11px] text-slate-500">
                  Rollen verwalten:
                  <span :class="guildInfo.autoRole.canManageRoles ? 'text-emerald-400' : 'text-red-400'">
                    {{ guildInfo.autoRole.canManageRoles ? 'vorhanden' : 'fehlt' }}
                  </span>
                  <template v-if="guildInfo.autoRole.botHighestRoleName">
                    · höchste Bot-Rolle: @{{ guildInfo.autoRole.botHighestRoleName }}
                  </template>
                </p>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              class="btn-primary"
              :disabled="savingAutoRole || saving || !autoRoleDirty || !autoRolePreview?.assignable"
              @click="saveAutoRole"
            >
              <LoaderCircle v-if="savingAutoRole" class="h-4 w-4 animate-spin" />
              <Save v-else class="h-4 w-4" />
              {{ savingAutoRole ? 'Speichere…' : 'Startrolle speichern' }}
            </button>
            <button
              class="btn-secondary"
              :disabled="reconciling || savingAutoRole || !canReconcile"
              @click="confirmReconcile = true"
            >
              <LoaderCircle v-if="reconciling" class="h-4 w-4 animate-spin" />
              <RefreshCw v-else class="h-4 w-4" />
              Fehlende Rollen nachtragen
            </button>
          </div>
          <p v-if="autoRoleDirty" class="text-xs text-slate-500">
            Speichere die Startrolle, bevor du fehlende Rollen nachträgst.
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
              class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-hidden"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-400">Emoji</label>
            <input
              type="text"
              maxlength="32"
              v-model="settings.starboardEmoji"
              class="mt-1 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white focus:border-blurple focus:outline-hidden"
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
              class="mt-0.5 h-4 w-4 rounded-sm border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
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
              class="mt-0.5 h-4 w-4 rounded-sm border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
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
                  class="w-20 rounded-sm border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-hidden"
                />
                <span class="text-slate-400">Mentions (@everyone zählt als 5)</span>
              </div>
            </div>
          </label>

          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.automodCapsFilter"
              class="mt-0.5 h-4 w-4 rounded-sm border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
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
                  class="w-20 rounded-sm border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-hidden"
                />
                <span class="text-slate-400">% Großbuchstaben, Min-Länge:</span>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  v-model.number="settings.automodCapsMinLen"
                  class="w-20 rounded-sm border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-hidden"
                />
                <span class="text-slate-400">Zeichen</span>
              </div>
            </div>
          </label>

          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              v-model="settings.automodExternalLinkFilter"
              class="mt-0.5 h-4 w-4 rounded-sm border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
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
                class="mt-2 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blurple focus:outline-hidden"
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
            class="mt-2 w-full rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blurple focus:outline-hidden"
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
              class="mt-0.5 h-4 w-4 rounded-sm border-slate-600 bg-slate-800 text-blurple focus:ring-blurple"
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
                  class="w-20 rounded-sm border border-border bg-slate-900 px-2 py-0.5 text-white focus:border-blurple focus:outline-hidden"
                />
                <span class="text-slate-400">(0.0-1.0, default 0.7 = streng. Niedriger = aggressiver.)</span>
              </div>
            </div>
          </label>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button class="btn-primary" :disabled="saving || savingAutoRole" @click="save">
          <Save class="h-4 w-4" />
          {{ saving ? 'Speichere…' : 'Speichern' }}
        </button>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmReconcile"
      title="Fehlende Startrollen nachtragen?"
      :description="autoRolePreview?.roleName
        ? `Der Bot prüft Beitritte der letzten 30 Tage, die noch keine zusätzliche Serverrolle haben, und vergibt @${autoRolePreview.roleName}. Pro Lauf werden höchstens 50 Mitglieder bearbeitet.`
        : 'Der Bot prüft rollenlose Beitritte der letzten 30 Tage und vergibt die konfigurierte Startrolle.'"
      confirm-label="Rollen nachtragen"
      tone="warning"
      :busy="reconciling"
      @cancel="confirmReconcile = false"
      @confirm="reconcileAutoRole"
    />
  </div>
</template>
