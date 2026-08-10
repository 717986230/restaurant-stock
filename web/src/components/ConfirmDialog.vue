<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { confirmState, settleConfirm } from '@/confirm';

const confirmButton = ref<HTMLButtonElement | null>(null);

watch(
  () => confirmState.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    confirmButton.value?.focus();
  },
);

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') settleConfirm(false);
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div v-if="confirmState.open" class="confirm-mask" @click.self="settleConfirm(false)">
        <section
          class="confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
        >
          <div :class="['confirm-icon', confirmState.tone]" aria-hidden="true">!</div>
          <div class="confirm-copy">
            <h2 id="confirm-title">{{ confirmState.title }}</h2>
            <p id="confirm-message">{{ confirmState.message }}</p>
          </div>
          <div class="confirm-actions">
            <button class="btn" @click="settleConfirm(false)">{{ confirmState.cancelText }}</button>
            <button
              ref="confirmButton"
              :class="['btn', confirmState.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary']"
              @click="settleConfirm(true)"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(13, 15, 18, 0.62);
  backdrop-filter: blur(2px);
}

.confirm-panel {
  width: min(100%, 390px);
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--card);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
}

.confirm-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin-bottom: 16px;
  border-radius: 50%;
  color: var(--brand);
  background: var(--brand-soft);
  font-size: 22px;
  font-weight: 750;
}

.confirm-icon.danger {
  color: var(--danger);
  background: var(--danger-soft);
}

.confirm-copy h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 680;
}

.confirm-copy p {
  margin: 8px 0 22px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
}

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.btn-danger-solid {
  border-color: var(--danger);
  color: #fff;
  background: var(--danger);
}

.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}

.confirm-enter-active .confirm-panel,
.confirm-leave-active .confirm-panel {
  transition: transform 0.2s ease, opacity 0.18s ease;
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}

.confirm-enter-from .confirm-panel,
.confirm-leave-to .confirm-panel {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

@media (max-width: 480px) {
  .confirm-mask {
    place-items: end center;
    padding: 0;
  }

  .confirm-panel {
    width: 100%;
    padding: 22px 18px calc(18px + env(safe-area-inset-bottom));
    border-width: 1px 0 0;
    border-radius: 18px 18px 0 0;
  }

  .confirm-enter-from .confirm-panel,
  .confirm-leave-to .confirm-panel {
    transform: translateY(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .confirm-enter-active,
  .confirm-leave-active,
  .confirm-enter-active .confirm-panel,
  .confirm-leave-active .confirm-panel {
    transition: none;
  }
}
</style>

