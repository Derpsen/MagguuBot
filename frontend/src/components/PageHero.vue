<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  icon?: Component;
  eyebrow: string;
  title: string;
  description: string;
}>();
</script>

<template>
  <section class="page-hero">
    <div class="min-w-0">
      <p class="mini-label">{{ eyebrow }}</p>
      <h1 class="mt-1.5 text-3xl font-semibold tracking-[-0.02em] text-white">
        {{ title }}
      </h1>
      <p class="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.default" class="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      <slot />
    </div>
  </section>
</template>
