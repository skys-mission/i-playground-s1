/** 头像统一裁剪尺寸（data URL 存库，128px 足够列表与对局页展示） */
export const AVATAR_SIZE = 128;

/** 入库前的 data URL 长度上限（128px PNG 通常 < 60KB） */
export const AVATAR_MAX_LENGTH = 700_000;

/** 把用户上传的图片居中裁剪为 128×128 的 PNG data URL（保留透明通道） */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法创建画布");
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("图片处理失败"));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}
