<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { AlertTriangle, LoaderCircle, X } from '@lucide/vue';

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: 'danger' | 'warning';
}>(), {
  confirmLabel: 'Bestätigen',
  cancelLabel: 'Abbrechen',
  busy: false,
  tone: 'danger',
});

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const confirmButton = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !props.busy) emit('cancel');
}

watch(() => props.open, async (open) => {
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.addEventListener('keydown', onKeydown);
    await nextTick();
    confirmButton.value?.focus();
  } else {
    window.removeEventListener('keydown', onKeydown);
    previousFocus?.focus();
    previousFocus = null;
  }
});

onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        @mousedown.self="!busy && emit('cancel')"
      >
        <div class="w-full max-w-md overflow-hidden rounded-[24px] border border-line-strong bg-surface-1 shadow-pop">
          <div class="flex items-start gap-4 p-5 sm:p-6">
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border"
              :class="tone === 'danger' ? 'border-red-400/20 bg-red-400/10 text-red-300' : 'border-amber-400/20 bg-amber-400/10 text-amber-300'"
            >
              <AlertTriangle class="h-5 w-5" />
            </div>
            <div class="min-w-0 flex-1">
              <h2 id="confirm-dialog-title" class="text-lg font-bold tracking-tight text-white">{{ title }}</h2>
              <p class="mt-2 text-sm leading-relaxed text-slate-400">{{ description }}</p>
            </div>
            <button class="btn-icon -mr-2 -mt-2" :disabled="busy" aria-label="Dialog schließen" @click="emit('cancel')">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="flex flex-col-reverse gap-2 border-t border-line bg-surface-2/40 px-5 py-4 sm:flex-row sm:justify-end">
            <button class="btn-secondary" :disabled="busy" @click="emit('cancel')">{{ cancelLabel }}</button>
            <button
              ref="confirmButton"
              class="btn-danger"
              :class="tone === 'warning' ? 'bg-amber-600/90 hover:bg-amber-600' : ''"
              :disabled="busy"
              @click="emit('confirm')"
            >
              <LoaderCircle v-if="busy" class="h-4 w-4 animate-spin" />
              <AlertTriangle v-else class="h-4 w-4" />
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 180ms ease;
}

.dialog-fade-enter-active > div,
.dialog-fade-leave-active > div {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from > div,
.dialog-fade-leave-to > div {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
