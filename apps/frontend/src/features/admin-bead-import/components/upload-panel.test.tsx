import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DIRECTORY_UNSUPPORTED_NOTICE } from "../folder-picker";
import { UPLOAD_QUEUE_CONCURRENCY, type UploadFileProgress, type UploadQueueState } from "../upload-queue";
import { UploadPanel } from "./upload-panel";

const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "storageKey",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "MYSTCRAG_ASSET_ARCHIVE_ROOT",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "C:\\",
  "prisma",
  "postgres"
];

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财"];

const SOURCE = readFileSync(join(__dirname, "upload-panel.tsx"), "utf8");

function fileRow(overrides: Partial<UploadFileProgress> = {}): UploadFileProgress {
  return {
    clientFileId: "cf-1",
    fileId: "file-1",
    label: "批次/a.jpg",
    relativePath: "批次/a.jpg",
    byteSize: 2048,
    status: "QUEUED",
    message: null,
    attempts: 0,
    ...overrides
  };
}

function queueState(overrides: Partial<UploadQueueState> = {}): UploadQueueState {
  return {
    phase: "IDLE",
    files: [],
    totals: {
      registered: 0,
      archived: 0,
      skipped: 0,
      failed: 0,
      rejected: 0,
      uploadedBytes: 0,
      declaredBytes: 0
    },
    message: null,
    ...overrides
  };
}

function render(props: Partial<Parameters<typeof UploadPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <UploadPanel
      support={{ folderInput: true, folderDrop: true }}
      queue={queueState()}
      walking={false}
      pickedCount={0}
      unreadableCount={0}
      disabled={false}
      disabledReason={null}
      onPickFolder={() => {}}
      onFilesPicked={() => {}}
      onDropItems={() => {}}
      onRetryFile={() => {}}
      onCancel={() => {}}
      {...props}
    />
  );
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function assertClean(value: string, label: string): void {
  for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS]) {
    assert.ok(!value.includes(forbidden), `${label} must not mention ${forbidden}`);
  }
}

test("the panel offers a folder button, a labelled directory input and a drop region", () => {
  const html = render();
  assert.match(html, /<button[^>]*>选择文件夹<\/button>/);
  assert.match(html, /id="bead-import-folder-input"/);
  assert.match(html, /type="file"/);
  assert.match(html, /webkitdirectory=""/);
  assert.match(html, /aria-label="选择要导入的素材文件夹"/);
  assert.match(html, /aria-labelledby="bead-import-drop-heading"/);
  assert.match(html, /id="bead-import-drop-heading"/);
  assertClean(html, "upload panel markup");
});

test("a browser without folder support is told so and keeps showing the run", () => {
  const html = render({
    support: { folderInput: false, folderDrop: false },
    queue: queueState({
      phase: "COMPLETE",
      files: [fileRow({ status: "FAILED", message: "服务端未确认该文件已归档，请重试。" })],
      totals: { registered: 1, archived: 0, skipped: 0, failed: 1, rejected: 0, uploadedBytes: 0, declaredBytes: 2048 }
    })
  });

  assert.ok(html.includes(DIRECTORY_UNSUPPORTED_NOTICE), "the notice must be spelled out, not implied");
  const noticeStart = html.indexOf('id="bead-import-directory-unsupported"');
  assert.ok(noticeStart >= 0, "the notice needs a stable, addressable element");
  const notice = html.slice(noticeStart, html.indexOf("</p>", noticeStart));
  assert.equal(/hidden|sr-only/.test(notice), false, "the notice must be visible");
  assert.ok(notice.includes(DIRECTORY_UNSUPPORTED_NOTICE));
  assert.match(html, /<button[^>]*disabled[^>]*>选择文件夹<\/button>/);
  assert.ok(html.includes("上传失败"), "the run stays readable without folder support");
  assert.ok(html.includes("服务端未确认该文件已归档，请重试。"));
});

test("the drop region is inert and the reason is stated when the session refuses uploads", () => {
  const html = render({ disabled: true, disabledReason: "当前任务状态不允许继续上传。" });
  assert.ok(html.includes("当前任务状态不允许继续上传。"));
  assert.match(html, /<button[^>]*disabled[^>]*>选择文件夹<\/button>/);
});

test("progress reports the archived share of the registered files", () => {
  const html = render({
    queue: queueState({
      phase: "UPLOADING",
      files: [
        fileRow({ fileId: "file-1", status: "ARCHIVED" }),
        fileRow({ fileId: "file-2", clientFileId: "cf-2", label: "批次/b.jpg", relativePath: "批次/b.jpg", status: "UPLOADING", attempts: 1 })
      ],
      totals: { registered: 2, archived: 1, skipped: 0, failed: 0, rejected: 0, uploadedBytes: 2048, declaredBytes: 4096 }
    })
  });

  assert.match(html, /<progress[^>]*value="1"[^>]*max="2"/);
  assert.match(html, /aria-live="polite"/);
  assert.ok(html.includes("正在上传素材…"));
  assert.ok(html.includes("上传中"));
  assert.ok(html.includes("已归档"));
});

test("no progress bar is drawn before anything is registered", () => {
  assert.equal(/<progress/.test(render()), false);
});

test("a failed file keeps its own reason and an offered retry", () => {
  const html = render({
    queue: queueState({
      phase: "COMPLETE",
      files: [
        fileRow({ fileId: "file-1", status: "ARCHIVED" }),
        fileRow({ fileId: "file-2", clientFileId: "cf-2", label: "批次/b.jpg", relativePath: "批次/b.jpg", status: "FAILED", message: "文件超出允许的大小上限。", attempts: 1 })
      ],
      totals: { registered: 2, archived: 1, skipped: 0, failed: 1, rejected: 0, uploadedBytes: 2048, declaredBytes: 4096 },
      message: "有 1 个文件未归档，请逐个重试。"
    })
  });

  assert.ok(html.includes("有 1 个文件未归档，请逐个重试。"));
  assert.ok(html.includes("文件超出允许的大小上限。"));
  assert.match(html, /<button[^>]*aria-label="重试上传 批次\/b\.jpg"[^>]*>重试<\/button>/);
  assert.equal(countOf(html, ">重试<"), 1, "an archived file must not offer a retry");
});

test("a refused file is listed with its reason and without any path", () => {
  const html = render({
    queue: queueState({
      phase: "COMPLETE",
      files: [
        fileRow({
          clientFileId: null,
          fileId: null,
          label: "secret.jpg",
          relativePath: null,
          byteSize: 0,
          status: "REJECTED",
          message: "无法接受该文件的路径：只允许不含盘符、上级目录或绝对前缀的相对路径。"
        })
      ],
      totals: { registered: 0, archived: 0, skipped: 0, failed: 0, rejected: 1, uploadedBytes: 0, declaredBytes: 0 }
    })
  });

  assert.ok(html.includes("未接受"));
  assert.ok(html.includes("secret.jpg"));
  assert.equal(html.includes("relativePath"), false);
  assertClean(html, "refused file row");
});

test("an unreadable count from the folder walk reaches the operator", () => {
  const html = render({ unreadableCount: 3, pickedCount: 12 });
  assert.match(html, /3 个文件无法读取/);
  assert.match(html, /12/);
});

test("a running upload can be cancelled and a finished one cannot", () => {
  const running = render({ queue: queueState({ phase: "UPLOADING" }) });
  assert.match(running, /<button[^>]*>停止上传<\/button>/);
  assert.equal(/停止上传/.test(render({ queue: queueState({ phase: "COMPLETE" }) })), false);
  assert.equal(/停止上传/.test(render({ queue: queueState({ phase: "IDLE" }) })), false);
});

test("the panel walks a folder before anything is registered", () => {
  const html = render({ walking: true });
  assert.match(html, /aria-busy="true"/);
  assert.ok(html.includes("正在读取所选文件夹…"));
});

test("the panel is a presentational component with no side effects of its own", () => {
  assert.equal(SOURCE.startsWith('"use client"'), false);
  for (const forbidden of ["fetch(", "process.env", "localStorage", "sessionStorage", "document.cookie", "XMLHttpRequest"]) {
    assert.equal(SOURCE.includes(forbidden), false, `the view must not reach for ${forbidden}`);
  }
  for (const required of ["onDrop", "onDragOver", "preventDefault()", "onDropItems(", "UPLOAD_QUEUE_CONCURRENCY"]) {
    assert.ok(SOURCE.includes(required), `the view must wire ${required}`);
  }
  assertClean(SOURCE, "upload panel source");
});

test("the panel keeps a phone-width layout without horizontal overflow", () => {
  const html = render({
    queue: queueState({
      phase: "COMPLETE",
      files: [fileRow({ label: "批次/超长文件名用于验证换行行为-0001.jpg", relativePath: "批次/超长文件名用于验证换行行为-0001.jpg", status: "ARCHIVED" })],
      totals: { registered: 1, archived: 1, skipped: 0, failed: 0, rejected: 0, uploadedBytes: 2048, declaredBytes: 2048 }
    })
  });

  assert.equal(/<table/.test(html), false);
  assert.ok(html.includes("min-w-0"));
  assert.ok(html.includes("break-all"));
  assert.ok(html.includes("grid-cols-1"));
  for (const match of html.matchAll(/(?:min-|max-)?w-\[(\d+)px\]/g)) {
    const width = Number(match[1]);
    assert.ok(width <= 320, `${match[0]} cannot fit a 390px viewport`);
  }
  for (const forbidden of ["animate-spin", "animate-bounce", "animate-ping"]) {
    assert.equal(html.includes(forbidden), false, `${forbidden} ignores reduced motion unless guarded`);
  }
});

test("the pinned upload concurrency is stated as a number", () => {
  assert.equal(UPLOAD_QUEUE_CONCURRENCY, 3);
  assert.ok(render().includes("3"));
});
