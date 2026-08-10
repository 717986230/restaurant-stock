<script setup lang="ts">
import {
  dismissInstallPrompt,
  installApp,
  needsIosInstructions,
  showInstallPrompt,
} from '@/install';
</script>

<template>
  <Transition name="install">
    <section v-if="showInstallPrompt" class="install-prompt" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div class="install-icon" aria-hidden="true">📦</div>
      <div class="install-copy">
        <h2 id="install-title">安装门店库存</h2>
        <p v-if="needsIosInstructions">
          点浏览器底部的分享按钮，再选择“添加到主屏幕”。
        </p>
        <p v-else>添加到桌面，打开更快，使用起来和 App 一样。</p>
      </div>
      <div class="install-actions">
        <button class="install-later" @click="dismissInstallPrompt">稍后</button>
        <button v-if="!needsIosInstructions" class="install-now" @click="installApp">安装</button>
        <button v-else class="install-now" @click="dismissInstallPrompt">知道了</button>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.install-prompt {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(var(--nav-h) + 12px);
  z-index: 55;
  max-width: 460px;
  margin: 0 auto;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.24);
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 10px 12px;
}

.install-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--brand-soft);
  display: grid;
  place-items: center;
  font-size: 22px;
}

.install-copy h2 {
  margin: 1px 0 4px;
  font-size: 16px;
}

.install-copy p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}

.install-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.install-actions button {
  min-width: 72px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 650;
}

.install-later {
  color: var(--muted);
}

.install-now {
  background: var(--brand);
  color: #fff;
}

.install-actions button:focus-visible {
  outline: 3px solid var(--brand-soft);
  outline-offset: 2px;
}

.install-enter-active,
.install-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.install-enter-from,
.install-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .install-enter-active,
  .install-leave-active {
    transition: none;
  }
}
</style>
