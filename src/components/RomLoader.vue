<script setup lang="ts">
/**
 * First-load component: large drop-zone + click-to-browse fallback.
 *
 * Accepts a single `.nes` file, runs it through {@link validateRom},
 * and either emits `loaded` with the validated ROM + offsets or shows
 * a natural-language error message in place.
 *
 * Owns no persistent state — the parent (App or a store wired up in
 * Unit 6) is responsible for holding the validated ROM after this
 * component fires `loaded`.
 */
import { computed, ref } from 'vue';
import BaseButton from './common/BaseButton.vue';
import { validateRom, type ValidationSuccess } from '@/rom/validation';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'processing'; filename: string }
  | { kind: 'error'; message: string };

const emit = defineEmits<{
  (e: 'loaded', rom: ValidationSuccess): void;
}>();

const state = ref<LoadState>({ kind: 'idle' });
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const isProcessing = computed(() => state.value.kind === 'processing');

async function processFile(file: File): Promise<void> {
  state.value = { kind: 'processing', filename: file.name };
  const result = await validateRom(file);
  if (result.ok) {
    state.value = { kind: 'idle' };
    emit('loaded', result);
  } else {
    state.value = { kind: 'error', message: result.message };
  }
}

function onFileInputChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void processFile(file);
  }
  // Reset so selecting the same file again still triggers change.
  input.value = '';
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    void processFile(file);
  }
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  isDragging.value = true;
}

function onDragLeave(): void {
  isDragging.value = false;
}

function openFilePicker(): void {
  fileInput.value?.click();
}

function clearError(): void {
  state.value = { kind: 'idle' };
}
</script>

<template>
  <div class="w-full max-w-xl mx-auto space-y-4">
    <header class="text-center space-y-2">
      <h1 class="text-3xl font-bold text-ink">
        SMB2 Editor
      </h1>
      <p class="text-sm text-ink-muted">
        Edit Super Mario Bros. 2 levels in your browser. Your ROM stays on
        your device — nothing is uploaded.
      </p>
    </header>

    <div
      :class="[
        'relative flex flex-col items-center justify-center gap-3 px-6 py-12',
        'rounded-lg border-2 border-dashed transition-colors',
        isDragging
          ? 'border-accent bg-accent/5'
          : 'border-panel-border bg-panel',
        state.kind === 'error' ? 'border-status-danger' : '',
      ]"
      role="button"
      :aria-label="'Drop your Super Mario Bros. 2 ROM here, or click to browse'"
      tabindex="0"
      @click="openFilePicker"
      @keydown.enter="openFilePicker"
      @keydown.space.prevent="openFilePicker"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".nes,application/octet-stream"
        class="hidden"
        @change="onFileInputChange"
      >

      <template v-if="state.kind === 'processing'">
        <p class="text-ink font-medium">
          Checking {{ state.filename }}…
        </p>
      </template>

      <template v-else-if="state.kind === 'error'">
        <p class="text-status-danger font-medium text-center">
          {{ state.message }}
        </p>
        <BaseButton
          variant="secondary"
          size="sm"
          @click.stop="clearError"
        >
          Try another file
        </BaseButton>
      </template>

      <template v-else>
        <svg
          class="w-10 h-10 text-ink-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0l-4 4m4-4l4 4"
          />
        </svg>
        <p class="text-ink font-medium text-center">
          Drop your <code class="px-1 bg-panel-subtle rounded">.nes</code>
          file here
        </p>
        <p class="text-sm text-ink-muted">
          or click to browse your computer
        </p>
        <p class="text-xs text-ink-muted pt-2">
          Super Mario Bros. 2 (USA, PRG0) required
        </p>
      </template>
    </div>

    <p
      v-if="!isProcessing"
      class="text-xs text-ink-muted text-center"
    >
      You must own your ROM. This editor never uploads or distributes any
      game data.
    </p>
  </div>
</template>
