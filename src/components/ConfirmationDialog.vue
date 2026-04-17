<script setup lang="ts">
/**
 * Reusable confirmation dialog — Unit 16.
 *
 * Modal overlay with a message, a cancel button, and a destructive
 * confirm button. Closes on ESC, backdrop click, or cancel.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import BaseButton from './common/BaseButton.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      dialogRef.value?.showModal();
    } else {
      dialogRef.value?.close();
    }
  },
);

function onCancel(): void {
  emit('cancel');
}

function onConfirm(): void {
  emit('confirm');
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    e.preventDefault();
    onCancel();
  }
}

function onBackdropClick(e: MouseEvent): void {
  if (e.target === dialogRef.value) {
    onCancel();
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <dialog
    ref="dialogRef"
    class="fixed inset-0 z-50 m-auto rounded-lg border border-panel-border bg-panel
           shadow-xl backdrop:bg-black/40 p-0 max-w-md w-full"
    @click="onBackdropClick"
  >
    <div class="p-6 space-y-4">
      <h2 class="text-base font-semibold text-ink">
        {{ title }}
      </h2>
      <p class="text-sm text-ink-muted">
        {{ message }}
      </p>
      <div class="flex justify-end gap-3 pt-2">
        <BaseButton
          variant="secondary"
          size="sm"
          @click="onCancel"
        >
          {{ cancelLabel ?? 'Cancel' }}
        </BaseButton>
        <BaseButton
          variant="danger"
          size="sm"
          @click="onConfirm"
        >
          {{ confirmLabel ?? 'Confirm' }}
        </BaseButton>
      </div>
    </div>
  </dialog>
</template>
