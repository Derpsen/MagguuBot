<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { LogIn } from '@lucide/vue';

const route = useRoute();
const authErrorMessages: Record<string, string> = {
  access_denied: 'Die Discord-Anmeldung wurde abgebrochen. Du kannst sie jederzeit erneut starten.',
  provider_error: 'Discord konnte die Anmeldung nicht abschließen. Bitte versuche es noch einmal.',
  provider_unavailable: 'Discord ist gerade nicht erreichbar. Bitte versuche es in einem Moment erneut.',
  code_missing: 'Die Anmeldeantwort war unvollständig. Bitte starte die Anmeldung erneut.',
  state_missing: 'Der sichere Anmelde-Cookie fehlte. Bitte starte die Anmeldung über diese Seite erneut.',
  state_mismatch: 'Diese Anmeldeantwort gehört zu einem älteren oder anderen Tab. Bitte starte sie erneut.',
  token_exchange: 'Der Discord-Anmeldecode konnte nicht eingelöst werden. Bitte versuche es erneut.',
  profile_fetch: 'Dein Discord-Profil konnte nicht geladen werden. Bitte versuche es erneut.',
  profile_invalid: 'Discord hat ein unerwartetes Profil geliefert. Bitte versuche es erneut.',
  not_allowed: 'Dein Discord-Account steht nicht in ADMIN_USER_IDS und darf dieses Dashboard nicht öffnen.',
};

const loginHighlights = [
  { title: 'Zugang', text: 'Anmeldung über Discord. Nur Accounts aus ADMIN_USER_IDS kommen hinein.' },
  { title: 'Sitzung', text: 'Nach der Anmeldung bleibst du auf diesem Gerät bis zu 30 Tage angemeldet.' },
  { title: 'Bereich', text: 'Anfragen, Webhooks, Moderation, Inhalte, Kanäle und Einstellungen des Bots.' },
];

const next = computed(() => typeof route.query.next === 'string' ? route.query.next : '/');
const loginUrl = computed(() => `/auth/login?next=${encodeURIComponent(next.value)}`);
const authError = computed(() => {
  if (typeof route.query.authError !== 'string') return null;
  return authErrorMessages[route.query.authError]
    ?? 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.';
});
</script>

<template>
  <div class="min-h-screen bg-surface-0 px-4 py-8 text-silver-200 flex items-center">
    <div class="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
      <section class="hidden pr-6 lg:block">
        <img src="/favicon-32.png" alt="MagguuUI" width="40" height="40" class="mb-6 h-10 w-10">
        <p class="mini-label mb-3 tracking-[0.16em]">Admin</p>
        <h1 class="mb-4 text-4xl font-semibold leading-tight tracking-tight text-white lg:text-5xl">Willkommen zurück</h1>
        <p class="max-w-lg text-base leading-relaxed text-silver-300 lg:text-lg">
          Melde dich an, um MagguuBot zu verwalten.
        </p>
        <div class="mt-10 max-w-lg space-y-5 border-t border-line pt-8">
          <div v-for="item in loginHighlights" :key="item.title">
            <p class="mini-label mb-1.5">{{ item.title }}</p>
            <p class="text-sm leading-relaxed text-silver-300">{{ item.text }}</p>
          </div>
        </div>
      </section>

      <section class="mx-auto w-full max-w-md">
        <img src="/favicon-32.png" alt="MagguuUI" width="32" height="32" class="mb-5 h-8 w-8 lg:hidden">
        <h2 class="mini-label mb-1.5">Anmelden</h2>
        <p class="text-2xl font-semibold tracking-tight text-white">MagguuBot</p>
        <p class="mt-1 text-sm text-slate-400">Mit deinem Discord-Account.</p>

        <p v-if="authError" class="mt-5 border-t border-amber-300/40 pt-3 text-sm leading-relaxed text-amber-300" role="alert">
          {{ authError }}
        </p>

        <a :href="loginUrl" class="btn-primary mt-6 w-full">
          <LogIn class="h-4 w-4" />
          Mit Discord anmelden
        </a>

        <p class="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-slate-400">
          Nur Accounts aus der <code>ADMIN_USER_IDS</code>-Allowlist haben Zugriff.
        </p>
      </section>
    </div>
  </div>
</template>
