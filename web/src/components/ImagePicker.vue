<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api';
import { toast, toastError } from '@/toast';
import { askConfirm } from '@/confirm';

const props = defineProps<{ itemId: number; hasImage: boolean }>();
const emit = defineEmits<{ changed: [hasImage: boolean] }>();

const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
// 换图之后要绕开浏览器缓存，所以在 URL 上挂一个变动的时间戳
const version = ref(Date.now());

const MAX_EDGE = 900;
const QUALITY = 0.82;

/**
 * 手机直出的照片动辄四五 MB，原样上传既慢又占数据库。
 * 先在本地缩到 900px 长边再转 JPEG，通常只剩 60~120KB，
 * 顺带把 iPhone 的 HEIC 也统一成 JPEG（浏览器解码后再画出来）。
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这台设备不支持图片压缩');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('图片处理失败');
  return blob;
}

async function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true;
  try {
    await api.uploadImage(props.itemId, await shrink(file));
    version.value = Date.now();
    emit('changed', true);
    toast('图片已保存');
  } catch (err) {
    toastError(err);
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function remove() {
  if (!await askConfirm({
    title: '删除货品图片？',
    message: '删除后无法恢复，可以稍后重新拍照上传。',
    confirmText: '删除图片',
    tone: 'danger',
  })) return;
  busy.value = true;
  try {
    await api.deleteImage(props.itemId);
    emit('changed', false);
    toast('图片已删除');
  } catch (err) {
    toastError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="picker">
    <div class="frame" @click="fileInput?.click()">
      <img v-if="hasImage" :src="`/api/items/${itemId}/image?t=${version}`" alt="货品图片" />
      <div v-else class="ph">
        <span class="ic">📷</span>
        <span class="small">拍张照片，采购时不认错货</span>
      </div>
      <div v-if="busy" class="busy">处理中…</div>
    </div>

    <div class="row">
      <button class="btn" :disabled="busy" @click="fileInput?.click()">
        {{ hasImage ? '换一张' : '上传图片' }}
      </button>
      <button v-if="hasImage" class="btn btn-danger" :disabled="busy" @click="remove">删除图片</button>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      @change="onPick"
    />
  </div>
</template>

<style scoped>
.picker {
  margin-bottom: 16px;
}

.frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg);
  border: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}

.frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ph {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--muted);
}

.ph .ic {
  font-size: 30px;
}

.busy {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 14px;
}
</style>
