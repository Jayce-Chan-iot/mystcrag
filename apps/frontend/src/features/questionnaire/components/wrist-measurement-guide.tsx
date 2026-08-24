import Image from "next/image";
import * as React from "react";

export function WristMeasurementGuide() {
  return (
    <aside
      aria-labelledby="wrist-measurement-guide-title"
      className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white/55"
    >
      <Image
        alt="软尺贴合手腕一圈的测量示意"
        className="aspect-[3/2] w-full object-cover"
        height={800}
        sizes="(max-width: 767px) 100vw, 360px"
        src="/guides/wrist-measurement.webp"
        width={1200}
      />
      <div className="px-4 py-4">
        <h2 className="font-medium" id="wrist-measurement-guide-title">如何量取净手围</h2>
        <ol className="mt-3 grid gap-2 text-sm leading-6 text-[var(--muted)]">
          <li><strong className="text-[var(--foreground)]">1.</strong> 软尺贴肤环绕腕骨下方一圈。</li>
          <li><strong className="text-[var(--foreground)]">2.</strong> 不要预留松量，也不要勒紧皮肤。</li>
          <li><strong className="text-[var(--foreground)]">3.</strong> 读取交会位置，将毫米数填入上方。</li>
        </ol>
      </div>
    </aside>
  );
}
