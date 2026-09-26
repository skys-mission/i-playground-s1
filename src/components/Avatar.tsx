/** 模型头像：有图显示图片，无图回退为名字首字符 */
export function Avatar({
  name,
  src,
  className = "",
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 本地 data URL，无需 next/image
      <img
        src={src}
        alt={name}
        className={`rounded-full object-cover ring-2 ring-white/15 ${className}`}
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center rounded-full bg-amber-300/60 font-black text-[#141414] ring-2 ring-amber-500/50 ${className}`}
    >
      {initial}
    </div>
  );
}
