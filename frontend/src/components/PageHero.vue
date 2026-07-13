<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  icon: Component;
  eyebrow: string;
  title: string;
  description: string;
}>();
</script>

<template>
  <section class="page-hero">
    <div class="relative z-10 flex min-w-0 items-start gap-4 sm:items-center">
      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blurple/20 bg-blurple-soft text-violet-300 shadow-[0_12px_35px_rgba(124,109,242,0.16)] sm:h-14 sm:w-14">
        <component :is="icon" class="h-6 w-6" />
      </div>
      <div class="min-w-0">
        <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300/80">
          {{ eyebrow }}
        </div>
        <h1 class="mt-1 text-2xl font-bold tracking-[-0.035em] text-white sm:text-3xl">
          {{ title }}
        </h1>
        <p class="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
          {{ description }}
        </p>
      </div>
    </div>
    <div v-if="$slots.default" class="relative z-10 flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      <slot />
    </div>
  </section>
</template>
