<script setup lang="ts">
import { useRoute } from 'vue-router';
import { LogIn } from 'lucide-vue-next';

const route = useRoute();
const next = typeof route.query.next === 'string' ? route.query.next : '/';
const loginUrl = `/auth/login?next=${encodeURIComponent(next)}`;
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-slate-950 p-4">
    <div class="w-full max-w-md">
      <div class="card text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blurple text-2xl font-bold text-white">
          M
        </div>
        <h1 class="text-2xl font-semibold text-white">MagguuBot Dashboard</h1>
        <p class="mt-2 text-sm text-slate-400">
          Login mit deinem Discord-Account. Nur Admins haben Zugriff.
        </p>
        <a :href="loginUrl" class="btn-primary mt-6 w-full justify-center">
          <LogIn class="h-4 w-4" />
          Mit Discord einloggen
        </a>
        <p class="mt-6 text-xs text-slate-600">
          Nicht auf der Allowlist? Frag einen Admin — er muss deine User-ID zur ENV-Var
          <code class="rounded bg-slate-800 px-1 py-0.5">ADMIN_USER_IDS</code> hinzufügen.
        </p>
      </div>
    </div>
  </div>
</template>
