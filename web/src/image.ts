const MAX_EDGE = 900;
const QUALITY = 0.82;

/**
 * 手机直出的照片动辄四五 MB，原样上传既慢又占数据库。
 * 先在本地缩到 900px 长边再转 JPEG，通常只剩 60~120KB，
 * 顺带把 iPhone 的 HEIC 也统一成 JPEG（浏览器解码后再画出来）。
 */
export async function shrinkImage(file: File, maxEdge = MAX_EDGE, quality = QUALITY): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这台设备不支持图片压缩');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('图片处理失败');
  return blob;
}
