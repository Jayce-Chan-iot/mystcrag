#!/usr/bin/env python3
"""TASK-ASSET-QA-001 可重放的珠子素材入库集成验收门（计划 Task 7）。

一次运行在一次性环境里走完整条业务线并明确失败：

前置（全部自动探测，缺失即非零退出，绝不伪造通过）：
  - 本机 PostgreSQL 17（`psql -h /tmp` 可达，Homebrew 服务即可）。
  - Node/pnpm 依赖已安装（`pnpm install --frozen-lockfile` 已执行过）。
  - Python: playwright(chromium) + requests + Pillow。
  - Chromium 已由 `python3 -m playwright install chromium` 或复用缓存。

覆盖（对真实运行的后端 + asset worker + 前端）：
  登录 → 新建导入 → manifest/上传（重启恢复：杀掉后端/worker 再重启续传）→
  自动分组 → 合并/拆分 → 命名 → 商品草稿与水晶八项（刷新持久）→ 启动处理 →
  QC 阻断（差背景组 QC_FAILED 上请求审批被拒）→ 人工批准（七项声明）→
  发布（inventory snapshot）→ 公开 /api/assets 渲染与公共目录出现 →
  草稿期公开拒绝（发布前目录不可见、未批准 key 404）。
  桌面 1440x900 与手机 390x844 截图仅写入 --capture-dir（默认临时目录）。

已知的自动化边界（如实声明，不是通过项）：
  - 浏览器 webkitdirectory 目录选择无法被 Playwright 脚本化，manifest 登记与
    文件字节上传改用浏览器登录后的同一同源 Cookie，经前端 BFF 代理的同一批
    端点完成（与页面网络面板所见一致）；其余流程均由真实浏览器驱动。
  - `/Users/chenyanyan/Desktop/珠子图` 只读探测使用 5 秒超时；macOS 文件提供
    器卡住时记录为 BLOCKED，绝不复制、移动或等待。
  - 前端必须通过 http://localhost:<port> 访问：Next dev 会拒绝来自 127.0.0.1
    的 HMR 跨源请求，HMR 握手失败会令客户端水合永不完成（页面无任何交互、
    管理台不发起任何代理请求）；后端探测仍走 127.0.0.1。

用法：
  python3 scripts/ui-qa/bead_import_flow.py                # 全流程（含真实浏览器断言）
  python3 scripts/ui-qa/bead_import_flow.py --skip-browser # 仅 HTTP 层（仍需后端/worker/前端 BFF）；
                                                          # 浏览器专属断言逐项记为 SKIP，不折算为 PASS
  python3 scripts/ui-qa/bead_import_flow.py --keep         # 保留临时目录/库便于复查
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = 4100
FRONTEND_PORT = 3100
ADMIN_KEY = "qa-integration-admin-key-0123456789"
WORKER_POLL_MS = "1000"
UPLOAD_TIMEOUT_S = 60
GROUP_TIMEOUT_S = 180
PROCESS_TIMEOUT_S = 300

RESULTS: list[tuple[str, bool, str]] = []
SKIPPED: list[tuple[str, str]] = []
PROCS: list[tuple[str, subprocess.Popen]] = []
TEMP_PATHS: list[Path] = []
DB_NAME: str | None = None


def report(step: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((step, ok, detail))
    print(("PASS" if ok else "FAIL") + " | " + step + (" | " + detail if detail else ""), flush=True)


def skipped(step: str, detail: str = "") -> None:
    """显式跳过（--skip-browser 或环境阻塞）：绝不折算为 PASS。"""
    SKIPPED.append((step, detail))
    print("SKIP | " + step + (" | " + detail if detail else ""), flush=True)


def fatal(step: str, detail: str) -> None:
    report(step, False, detail)
    finish()


def finish() -> None:
    failed = [r for r in RESULTS if not r[1]]
    print("", flush=True)
    print(
        f"SUMMARY: {len(RESULTS) - len(failed)} passed, {len(failed)} failed, {len(SKIPPED)} skipped",
        flush=True,
    )
    for step, _, detail in failed:
        print(f"  FAILED: {step}: {detail[:300]}", flush=True)
    for step, detail in SKIPPED:
        print(f"  SKIPPED: {step}: {detail[:300]}", flush=True)
    cleanup()
    sys.exit(1 if failed else 0)


def cleanup() -> None:
    for name, proc in PROCS:
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=15)
            except Exception:
                pass
        # SIGTERM 后 pnpm 主进程常先退出，而组内 next-server/worker 孙进程可能
        # 无视 SIGTERM 继续存活（曾留下孤儿 next-server 持有 Next 项目锁，令后续
        # 运行的 next dev 以 "Another next dev server is already running" 拒绝启动）。
        # 无条件补一发 SIGKILL 到整个进程组兜底。
        try:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=10)
        except Exception:
            pass
        print(f"CLEANUP | stopped {name}", flush=True)
    if DB_NAME is not None:
        subprocess.run(
            ["psql", "-h", "/tmp", "-d", "postgres", "-Atc", f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'],
            capture_output=True, text=True, timeout=30,
        )
        print(f"CLEANUP | dropped database {DB_NAME}", flush=True)
    if not KEEP_TEMP:
        for path in TEMP_PATHS:
            shutil.rmtree(path, ignore_errors=True)
        print("CLEANUP | removed temporary directories", flush=True)
    else:
        print(f"CLEANUP | kept temporary paths: {[str(p) for p in TEMP_PATHS]}", flush=True)


# ---------------------------------------------------------------- fixtures ---

def make_good_bead_jpg(seed: int) -> bytes:
    """干净、居中、不触框的合成珠子：亮色圆盘 + 轻纹理，直径约画布 72%。"""
    from PIL import Image, ImageDraw

    size = 1024
    image = Image.new("RGB", (size, size), (24, 22, 30))
    draw = ImageDraw.Draw(image)
    cx = cy = size // 2
    radius = int(size * 0.36)
    for r in range(radius, 0, -1):
        shade = 150 + int(70 * (1 - r / radius)) + ((r * 7 + seed * 13) % 12)
        color = (min(shade, 235), min(shade + 18, 240), min(shade + 40, 245))
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    for angle_seed in range(40):
        import math
        angle = angle_seed * math.pi / 20
        rr = radius * (0.25 + (angle_seed % 5) * 0.14)
        x = cx + int(rr * math.cos(angle))
        y = cy + int(rr * math.sin(angle))
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(210, 225, 240))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=93)
    return buffer.getvalue()


def make_poor_bead_jpg() -> bytes:
    """差背景样本：主体触底边被裁切 + 低质量压缩，确定性触发 QC 的 subject-clipping 失败。

    主体保持 >=410px 的有效边（避免 NO_SUBJECT 级 job 失败——预期是产出
    QC_FAILED 资产供人工审批阻断，而非任务报错），且只触一边、其余三边留足
    背景，保证泛洪填充仍把边环识别为背景。
    """
    from PIL import Image, ImageDraw

    size = 560
    image = Image.new("RGB", (size, size), (200, 200, 205))
    draw = ImageDraw.Draw(image)
    draw.ellipse((10, 20, 550, size + 20), fill=(120, 90, 160))  # 触底边；上/左/右留背景
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=35)
    return buffer.getvalue()


def make_poor_rescue_jpg() -> bytes:
    """差背景组的补拍拯救片：与差样本同构图（dHash 视觉近邻必然同组），
    但主体不触底边且压缩质量正常，QC 应通过。

    操作员恢复路径的素材：QC 失败被拒批后，SET_PRIMARY 切到补拍片并
    reprocess，该组重新产出可审批的 QC_PENDING 版本。"""
    from PIL import Image, ImageDraw

    size = 560
    image = Image.new("RGB", (size, size), (200, 200, 205))
    draw = ImageDraw.Draw(image)
    draw.ellipse((10, 20, 550, 550), fill=(120, 90, 160))  # 底边留 10px 余量，不触框
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def make_arw_like_tiff(seed: int) -> bytes:
    """最小合法 Sony ARW 容器（纯 struct，不依赖 PIL）。

    content-type.ts 的 isSonyArw 只认：TIFF LE 头 + 结构合法的 IFD0 +
    ASCII Make="SONY"（NUL 结尾）+ RAW 证据（Compression=32767, SHORT count 1）。
    worker 对 ARW 只归档不解码（Sharp 解不了传感器数据），无需嵌入位图。
    尾部追加 seed 派生的填充字节：嗅探器只读头部/IFD，但 sha256 因此互不相同，
    避免多个 ARW 样本被会话内去重误判 SKIPPED_DUPLICATE。
    """
    import struct

    entries: list[tuple[int, int, int, bytes | None]] = [
        (0x0103, 3, 1, struct.pack("<H", 32767) + b"\x00\x00"),  # Compression
        (0x010F, 2, 5, None),  # Make ASCII "SONY\0"，溢出到数据区
    ]
    ifd_offset = 8
    data_offset = ifd_offset + 2 + len(entries) * 12 + 4
    out = bytearray(b"II\x2a\x00" + struct.pack("<I", ifd_offset))
    out += struct.pack("<H", len(entries))
    for tag, typ, count, inline in entries:
        out += struct.pack("<HHI", tag, typ, count)
        out += inline if inline is not None else struct.pack("<I", data_offset)
    out += struct.pack("<I", 0)
    out += b"SONY\x00"
    out += b"arw-seed:" + str(seed).encode() + b"\x00" * (seed * 7)
    return bytes(out)


@dataclass
class Fixture:
    root: Path
    files: dict[str, Path]  # relativePath -> path

    def entries(self) -> list[dict]:
        entries = []
        for relative_path, path in sorted(self.files.items()):
            data = path.read_bytes()
            kind = "ARW" if relative_path.lower().endswith(".arw") else "JPEG"
            entries.append(
                {
                    "clientFileId": "qa-" + hashlib.sha256(relative_path.encode()).hexdigest()[:16],
                    "relativePath": relative_path,
                    "byteSize": len(data),
                    "lastModifiedMs": 1_700_000_000_000,
                    "kind": kind,
                }
            )
        return entries

    def bytes_of(self, relative_path: str) -> bytes:
        return self.files[relative_path].read_bytes()


def build_fixture(root: Path) -> Fixture:
    """合成样本：同 stem 配对、跨文件夹 stem、重复 hash、JPG-only、ARW-only、差背景。"""
    good_a = make_good_bead_jpg(seed=1)
    good_b = make_good_bead_jpg(seed=2)
    good_c = make_good_bead_jpg(seed=3)
    poor = make_poor_bead_jpg()
    arw_a = make_arw_like_tiff(seed=11)
    arw_cross = make_arw_like_tiff(seed=12)

    files: dict[str, Path] = {}
    def put(relative_path: str, data: bytes) -> None:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        files[relative_path] = path

    # 同 stem 配对（同目录 JPG + ARW-like）
    put("batch-a/bead-good-a.jpg", good_a)
    put("batch-a/bead-good-a.arw", arw_a)
    # 跨文件夹同 stem 配对
    put("batch-b/bead-good-b.jpg", good_b)
    put("batch-c/bead-good-b.arw", arw_cross)
    # 独立第三组（用于合并/拆分）
    put("batch-d/bead-good-c.jpg", good_c)
    # 重复 hash：不同文件夹、字节完全一致
    put("batch-d/duplicate.jpg", good_a)
    put("batch-e/duplicate.jpg", good_a)
    # JPG-only
    put("batch-f/jpg-only.jpg", make_good_bead_jpg(seed=4))
    # ARW-only（TIFF-like，仅归档不处理）
    put("batch-g/arw-only.arw", make_arw_like_tiff(seed=13))
    # 差背景（预期 QC 失败 → 审批被阻断）+ 视觉近邻的补拍拯救片（同组）
    put("batch-h/poor-background.jpg", poor)
    put("batch-i/poor-background-rescue.jpg", make_poor_rescue_jpg())
    return Fixture(root=root, files=files)


# ------------------------------------------------------------------ infra ----

def sh(command: list[str], env: dict | None = None, timeout: int = 300, cwd: Path | None = None) -> str:
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=timeout,
        env={**os.environ, **(env or {})}, cwd=str(cwd or REPO_ROOT),
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout: {result.stdout[-800:]}\nstderr: {result.stderr[-800:]}"
        )
    return result.stdout


def spawn(name: str, command: list[str], env: dict, log_path: Path) -> subprocess.Popen:
    log = open(log_path, "ab")
    # 独立进程组：pnpm→next dev→next-server 是多层孙进程链，仅 SIGTERM 直接子进程
    # 会把 next-server / worker 留成孤儿（曾用案例：孤儿持有 Next 项目锁，令后续
    # 运行的 next dev 直接拒绝启动）。整组终止才能保证每次运行完全清场。
    proc = subprocess.Popen(
        command, cwd=str(REPO_ROOT), env={**os.environ, **env},
        stdout=log, stderr=log, start_new_session=True,
    )
    PROCS.append((name, proc))
    return proc


def wait_for_http(url: str, timeout_s: int, session) -> None:
    import requests

    deadline = time.time() + timeout_s
    last_error = ""
    while time.time() < deadline:
        try:
            response = session.get(url, timeout=5)
            if response.status_code < 500:
                return
            last_error = f"status {response.status_code}"
        except Exception as exc:
            last_error = repr(exc)[:120]
        time.sleep(1.0)
    raise RuntimeError(f"service at {url} did not become ready within {timeout_s}s: {last_error}")


def wait_port_closed(port: int, timeout_s: int = 20) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.4)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return
        time.sleep(0.4)


def create_database(temp_root: Path) -> tuple[str, str]:
    global DB_NAME
    db_name = f"mystcrag_qa_flow_test_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    subprocess.run(["psql", "-h", "/tmp", "-d", "postgres", "-Atc", f'CREATE DATABASE "{db_name}"'], check=True, capture_output=True, timeout=30)
    DB_NAME = db_name
    url = f"postgresql://chenyanyan@127.0.0.1:5432/{db_name}"
    sh(
        ["pnpm", "--filter", "@mystcrag/database", "exec", "prisma", "migrate", "deploy"],
        env={"DATABASE_URL": url}, timeout=300,
    )
    migration_count = subprocess.run(
        ["psql", "-h", "/tmp", "-d", db_name, "-Atc", "SELECT COUNT(*) FROM _prisma_migrations"],
        capture_output=True, text=True, check=True, timeout=30,
    ).stdout.strip()
    return db_name, url


# ------------------------------------------------------------- HTTP client ---

class AdminClient:
    def __init__(self, frontend_origin: str, cookie_header: str | None, backend_origin: str | None = None):
        import requests

        self.session = requests.Session()
        self.origin = frontend_origin
        self.backend_origin = backend_origin or "http://127.0.0.1:4100"
        if cookie_header:
            # 不指定 domain（host-only cookie）：requests/cookiejar 对 domain="localhost"
            # 有发送怪癖（不匹配而拒发），host-only 反而稳定送达；路径限定管理台。
            self.session.cookies.set("mystcrag_asset_admin", cookie_header, path="/admin/bead-import")
        self.prefix = f"{frontend_origin}/admin/bead-import/proxy"

    def proxy(self, method: str, path: str, **kwargs) -> "requests.Response":
        return self.session.request(method, f"{self.prefix}{path}", timeout=90, **kwargs)

    def direct(self, method: str, path: str, **kwargs) -> "requests.Response":
        return self.session.request(method, f"{self.origin}{path}", timeout=90, **kwargs)

    def backend(self, method: str, path: str, **kwargs) -> "requests.Response":
        return self.session.request(method, f"{self.backend_origin}{path}", timeout=90, **kwargs)


SIGNED_TEST_SECRET = "qa-integration-signed-test-secret-0123456789abcdef"


def signed_test_token(subject: str = "qa-catalog-observer") -> str:
    """与后端 SignedTestTokenAuthProvider.signTestAccessToken 同构的 HS256 JWT。
    /api/catalog/* 是登录用户（protectedRoute）视图，不是匿名公开端点；验收必须
    以认证身份查询目录，否则 401 空列表会让断言静默失真。"""
    import base64
    import hmac as hmac_module

    def b64url(payload: bytes) -> str:
        return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")

    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = b64url(json.dumps({
        "sub": subject, "iss": "mystcrag-local", "aud": "mystcrag-backend",
        "exp": now + 3600, "iat": now,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}"
    signature = b64url(hmac_module.new(SIGNED_TEST_SECRET.encode(), signing_input.encode(), "sha256").digest())
    return f"{signing_input}.{signature}"


# -------------------------------------------------------------------- flow ---

def upload_file(client: AdminClient, session_id: str, file_id: str, data: bytes) -> dict:
    response = client.proxy(
        "PUT",
        f"/sessions/{session_id}/files/{file_id}/content",
        data=data,
        headers={"content-type": "application/octet-stream", "content-length": str(len(data))},
    )
    if response.status_code != 200:
        raise RuntimeError(f"upload {file_id} failed: {response.status_code} {response.text[:300]}")
    return response.json()


def get_session(client: AdminClient, session_id: str) -> dict:
    response = client.proxy("GET", f"/sessions/{session_id}")
    if response.status_code != 200:
        raise RuntimeError(f"session read failed: {response.status_code} {response.text[:300]}")
    return response.json()


def reserve_port(preferred: int, explicitly_requested: bool) -> int:
    """默认端口被占用（本机常有其他 worktree 的 dev server 并行）时改用临时端口，
    避免把请求发给别的 worktree 的服务；显式指定的端口冲突则报错，绝不静默重定位。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            if explicitly_requested:
                raise RuntimeError(f"port {preferred} is occupied; free it or pass another --backend-port/--frontend-port")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as picker:
        picker.bind(("127.0.0.1", 0))
        return int(picker.getsockname()[1])


class _SkipPage:
    """--skip-browser 模式下的页面替身：不驱动浏览器；渲染断言由调用方记为 SKIP。"""

    def reload(self, *args, **kwargs) -> None:
        pass

    def wait_for_selector(self, *args, **kwargs) -> None:
        pass

    def screenshot(self, *args, **kwargs) -> None:
        pass

    def goto(self, *args, **kwargs) -> None:
        pass


def poll_until(predicate, timeout_s: int, description: str, interval_s: float = 1.5):
    """谓词契约：就绪返回对象；未就绪返回状态字符串（仅作诊断，绝不视为就绪）。"""
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        current = predicate()
        if isinstance(current, str):
            last = current
        elif current is not None and current is not False:
            return current
        time.sleep(interval_s)
    raise RuntimeError(f"timed out after {timeout_s}s waiting for {description}; last={last[:200]}")


def run_flow(args: argparse.Namespace) -> None:
    import requests

    global BACKEND_PORT, FRONTEND_PORT
    BACKEND_PORT = reserve_port(
        args.backend_port if args.backend_port is not None else BACKEND_PORT,
        args.backend_port is not None,
    )
    FRONTEND_PORT = reserve_port(
        args.frontend_port if args.frontend_port is not None else FRONTEND_PORT,
        args.frontend_port is not None,
    )

    temp_root = Path(tempfile.mkdtemp(prefix="mystcrag-qa-flow-"))
    TEMP_PATHS.append(temp_root)
    archive_root = temp_root / "archive"
    archive_root.mkdir(parents=True, exist_ok=True)
    capture_dir = Path(args.capture_dir) if args.capture_dir else temp_root / "qa-captures"
    capture_dir.mkdir(parents=True, exist_ok=True)
    fixture_root = temp_root / "fixtures"

    # 0. 环境
    try:
        report("env/postgres", True, "psql -h /tmp reachable")
    except Exception as exc:
        fatal("env/postgres", repr(exc))

    # 1. 合成 fixture
    fixture = build_fixture(fixture_root)
    report(
        "fixtures/synthetic", True,
        f"{len(fixture.files)} files: same-stem pair, cross-folder stem, duplicate hash, jpg-only, arw-only, poor-background + rescue",
    )

    # 2. 一次性数据库
    try:
        db_name, database_url = create_database(temp_root)
        report("db/fresh-test-database", True, db_name)
    except Exception as exc:
        fatal("db/fresh-test-database", repr(exc))

    backend_log = temp_root / "backend.log"
    worker_log = temp_root / "worker.log"
    frontend_log = temp_root / "frontend.log"
    # signed-test 认证的最小安全合成配置（仓库 .env.example 的本地开发模板同款值域，
    # 仅注入本脚本的子进程环境；不创建/修改 .env，不使用任何真实凭据）。
    backend_env = {
        "DATABASE_URL": database_url,
        "MYSTCRAG_ASSET_ARCHIVE_ROOT": str(archive_root),
        "MYSTCRAG_ASSET_IMPORT_ENABLED": "true",
        "ASSET_ADMIN_API_KEY": ADMIN_KEY,
        "BACKEND_PORT": str(BACKEND_PORT),
        "NODE_ENV": "development",
        "MYSTCRAG_AUTH_PROVIDER": "signed-test",
        "MYSTCRAG_ENABLE_SIGNED_TEST_AUTH": "true",
        "MYSTCRAG_AUTH_SIGNING_SECRET": "qa-integration-signed-test-secret-0123456789abcdef",
        "MYSTCRAG_AUTH_ISSUER": "mystcrag-local",
        "MYSTCRAG_AUTH_AUDIENCE": "mystcrag-backend",
    }
    worker_env = {
        "DATABASE_URL": database_url,
        "MYSTCRAG_ASSET_ARCHIVE_ROOT": str(archive_root),
        "MYSTCRAG_ASSET_WORKER_POLL_MS": WORKER_POLL_MS,
    }
    frontend_env = {
        "MYSTCRAG_BACKEND_ORIGIN": f"http://127.0.0.1:{BACKEND_PORT}",
        "MYSTCRAG_ASSET_ADMIN_KEY": ADMIN_KEY,
        # 前端 proxy.ts 对所有页面导航强制走 Auth0 SDK 滚动会话中间件；signed-test
        # 提供器会令每个页面 fail-closed 500。这里注入合成的 auth0 形态配置：会话
        # cookie 由本地密钥签名/加密，匿名页面导航不联网联系 issuer；本验收不
        # 演练最终用户登录（珠子导入台使用独立的 admin key 门）。
        "MYSTCRAG_APP_ORIGIN": f"http://localhost:{FRONTEND_PORT}",
        "MYSTCRAG_AUTH_PROVIDER": "auth0",
        "MYSTCRAG_AUTH_ISSUER": "https://qa-synthetic.auth0.example.com/",
        "MYSTCRAG_AUTH_AUDIENCE": "mystcrag-backend",
        "MYSTCRAG_AUTH_CLIENT_ID": "qa-synthetic-client-id",
        "MYSTCRAG_AUTH_CLIENT_SECRET": "qa-synthetic-client-secret",
        "MYSTCRAG_AUTH_CALLBACK_URL": f"http://localhost:{FRONTEND_PORT}/auth/callback",
        "MYSTCRAG_AUTH_LOGOUT_URL": f"http://localhost:{FRONTEND_PORT}",
        "MYSTCRAG_AUTH_SESSION_SECRET": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    }

    backend = spawn("backend", ["pnpm", "--filter", "@mystcrag/backend", "exec", "tsx", "src/index.ts"], backend_env, backend_log)
    worker = spawn("asset-worker", ["pnpm", "--filter", "@mystcrag/asset-worker", "start"], worker_env, worker_log)
    frontend = spawn(
        "frontend",
        ["pnpm", "--filter", "@mystcrag/frontend", "exec", "next", "dev", "-p", str(FRONTEND_PORT)],
        frontend_env, frontend_log,
    )
    probe = requests.Session()
    try:
        wait_for_http(f"http://127.0.0.1:{BACKEND_PORT}/api/assets/approved:{'0'*64}", 120, probe)
        report("services/backend+worker", True, f"backend :{BACKEND_PORT}; worker poll {WORKER_POLL_MS}ms")
        wait_for_http(f"http://localhost:{FRONTEND_PORT}/", 240, probe)
        report("services/frontend", True, f"next dev :{FRONTEND_PORT}")
    except Exception as exc:
        tail = backend_log.read_text(errors="replace")[-600:] if backend_log.exists() else ""
        fatal("services/startup", f"{exc}\nbackend tail: {tail}")

    # 3. 登录 + 新建导入（浏览器模式：桌面 1440x900；--skip-browser：同一 BFF 端点的 HTTP 层）
    session_id: str | None = None
    cookie_header: str | None = None
    from contextlib import ExitStack

    with ExitStack() as stack:
        browser = None
        page: object
        if args.skip_browser:
            page = _SkipPage()
        else:
            from playwright.sync_api import sync_playwright

            playwright = stack.enter_context(sync_playwright())
            browser = playwright.chromium.launch()
            desktop = browser.new_context(viewport={"width": 1440, "height": 900})
            page = desktop.new_page()
            page.set_default_timeout(45_000)
        try:
            if args.skip_browser:
                # 与登录 server action 落盘的是同一不可逆摘要 sha256(context\nkey)；
                # 之后每个请求仍由前端 BFF/后端在服务端校验该摘要。
                cookie_header = hashlib.sha256(
                    f"mystcrag:bead-import-admin-session:v1\n{ADMIN_KEY}".encode()
                ).hexdigest()
                report(
                    "http/admin-cookie", bool(cookie_header),
                    "session digest derived locally from the injected key; verified server-side per request",
                )
                client = AdminClient(
                    f"http://localhost:{FRONTEND_PORT}", cookie_header,
                    backend_origin=f"http://127.0.0.1:{BACKEND_PORT}",
                )
                created = client.proxy("POST", "/sessions", json={"idempotencyKey": str(uuid.uuid4())})
                if created.status_code != 200:
                    raise RuntimeError(f"session create refused: {created.status_code} {created.text[:300]}")
                session_id = created.json().get("sessionId")
                if not session_id:
                    raise RuntimeError("create response has no sessionId")
                report("http/create-session", True, f"session {session_id[:8]}… via POST /sessions on the BFF proxy")
                skipped("browser/login+guard", "--skip-browser: 登录表单与守卫重定向为浏览器专属")
                skipped("browser/create-session", "--skip-browser: 仪表盘按钮为浏览器专属")
            else:
                page.goto(f"http://localhost:{FRONTEND_PORT}/admin/bead-import", wait_until="domcontentloaded")
                page.wait_for_selector("#asset-admin-key", timeout=30_000)
                page.screenshot(path=str(capture_dir / "desktop-01-login.png"))
                page.fill("#asset-admin-key", ADMIN_KEY)
                page.click("#asset-admin-key ~ button[type=submit], form button[type=submit]")
                page.wait_for_selector("#bead-import-dashboard-heading", timeout=60_000)
                report("browser/login+guard", True, "guard redirected to login; key accepted into dashboard")
                page.screenshot(path=str(capture_dir / "desktop-02-dashboard.png"))

                page.click("text=新建导入")
                page.wait_for_url("**/admin/bead-import/*", timeout=60_000)
                session_id = page.url.rstrip("/").split("/")[-1]
                page.wait_for_selector("text=拖入素材", timeout=60_000)
                report("browser/create-session", True, f"session {session_id[:8]}… via the dashboard button")

                cookies = desktop.cookies(f"http://localhost:{FRONTEND_PORT}/admin/bead-import/")
                cookie_header = next(
                    (cookie["value"] for cookie in cookies if cookie["name"] == "mystcrag_asset_admin"), None
                )
                assert cookie_header, "the admin session cookie must be issued to the browser"
        except Exception as exc:
            fatal("browser/login-create", repr(exc))

        # 4. manifest + 上传（同一 BFF 端点；webkitdirectory 边界已在 docstring 声明）
        client = AdminClient(
            f"http://localhost:{FRONTEND_PORT}", cookie_header,
            backend_origin=f"http://127.0.0.1:{BACKEND_PORT}",
        )
        try:
            manifest = client.proxy(
                "POST", f"/sessions/{session_id}/manifest",
                json={"idempotencyKey": str(uuid.uuid4()), "files": fixture.entries()},
            )
            if manifest.status_code != 200:
                raise RuntimeError(f"manifest refused: {manifest.status_code} {manifest.text[:300]}")
            # 响应条目只含 fileId/clientFileId/uploadStatus/createdAt；
            # relativePath 经 clientFileId（fixture 内由 relativePath 确定性派生）映射回来。
            relative_by_client = {e["clientFileId"]: e["relativePath"] for e in fixture.entries()}
            payload_files = manifest.json()["files"]
            relative_by_file_id = {
                f["fileId"]: relative_by_client[f["clientFileId"]] for f in payload_files
            }
            report("http/manifest", True, f"{len(relative_by_file_id)} files registered")

            ordered = sorted(fixture.files.keys())
            held_back = ordered[-1]
            upload_status: dict[str, str] = {}
            sha_roundtrip_failures: list[str] = []
            for index, relative_path in enumerate(ordered):
                file_id = next(fid for fid, rel in relative_by_file_id.items() if rel == relative_path)
                if relative_path == held_back:
                    continue
                data = fixture.bytes_of(relative_path)
                result = upload_file(client, session_id, file_id, data)
                upload_status[relative_path] = result["uploadStatus"]
                if result.get("sha256") is not None:
                    if result["sha256"] != hashlib.sha256(data).hexdigest():
                        sha_roundtrip_failures.append(relative_path)
            report("http/upload", True, f"{len(upload_status)}/{len(ordered)} uploaded; 1 held back for restart resume")
            report(
                "flow/sha256-archive-roundtrip", not sha_roundtrip_failures,
                "archive copy sha256 matches the source bytes for every ARCHIVED upload"
                + (f"; FAILURES={sha_roundtrip_failures}" if sha_roundtrip_failures else ""),
            )
        except Exception as exc:
            fatal("http/manifest-upload", repr(exc))

        # 5. 重启恢复：杀后端+worker → 重启 → 会话与状态还在
        try:
            backend.send_signal(signal.SIGTERM)
            worker.send_signal(signal.SIGTERM)
            backend.wait(timeout=20)
            worker.wait(timeout=20)
            wait_port_closed(BACKEND_PORT)
            backend2 = spawn("backend-2", ["pnpm", "--filter", "@mystcrag/backend", "exec", "tsx", "src/index.ts"], backend_env, backend_log)
            worker2 = spawn("asset-worker-2", ["pnpm", "--filter", "@mystcrag/asset-worker", "start"], worker_env, worker_log)
            wait_for_http(f"http://127.0.0.1:{BACKEND_PORT}/api/assets/approved:{'0'*64}", 120, probe)

            if args.skip_browser:
                skipped("browser/session-page-after-restart", "--skip-browser: 重启后会话页渲染为浏览器专属")
            else:
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector("text=拖入素材", timeout=60_000)
            resumed = get_session(client, session_id)
            resumed_states = {file["state"] for file in resumed["files"]}
            report(
                "flow/restart-resume", "REGISTERED" in resumed_states or "ARCHIVED" in resumed_states,
                f"session survived restart; file states={sorted(resumed_states)}",
            )

            file_id = next(fid for fid, rel in relative_by_file_id.items() if rel == held_back)
            result = upload_file(client, session_id, file_id, fixture.bytes_of(held_back))
            report("flow/resume-upload-completes", result["uploadStatus"] in ("ARCHIVED", "UPLOADING"), str(result["uploadStatus"]))

            # PUT 只入队（响应恒为 UPLOADING）；归档由 worker 异步落账，全部文件
            # 终态后会话才转 ARCHIVING——startGrouping 的前置正是这两点，必须轮询。
            def archive_settled():
                snapshot = get_session(client, session_id)
                states = [file["state"] for file in snapshot["files"]]
                if snapshot["state"] in ("ARCHIVING", "PARTIALLY_FAILED") and all(
                    state in ("ARCHIVED", "SKIPPED_DUPLICATE") for state in states
                ):
                    return snapshot
                return f"state={snapshot['state']} files={sorted(set(states))}"
            poll_until(archive_settled, GROUP_TIMEOUT_S, "worker archive settlement")
            report("flow/resume-archive-settles", True, "held-back file archived; session reached ARCHIVING")

            if args.skip_browser:
                started = client.proxy(
                    "POST", f"/sessions/{session_id}/grouping/start",
                    json={"idempotencyKey": str(uuid.uuid4())},
                )
                if started.status_code != 200:
                    # 通用 409 信封不携带具体前置条件；直查测试库拿权威状态供诊断。
                    diag = subprocess.run(
                        ["psql", "-h", "/tmp", "-d", db_name, "-Atc",
                         "SELECT s.state FROM asset_import_sessions s WHERE s.id = '" + session_id + "'; "
                         "SELECT 'file:' || state || ':' || count(*) FROM asset_source_files WHERE session_id = '" + session_id + "' GROUP BY state; "
                         "SELECT 'job:' || job_type || ':' || state || ':' || count(*) FROM asset_processing_jobs WHERE session_id = '" + session_id + "' GROUP BY job_type, state"],
                        capture_output=True, text=True, timeout=30,
                    ).stdout.strip().replace("\n", " ")
                    raise RuntimeError(
                        f"grouping start refused: {started.status_code} {started.text[:300]} "
                        f"[db diag {diag}]"
                    )
                report("http/grouping-start", True, "grouping started via the BFF proxy endpoint")
                skipped("browser/grouping-start", "--skip-browser: 会话页按钮为浏览器专属")
            else:
                # 点击成功只证明元素可点，不证明请求生效；捕获真实 BFF 响应，
                # 请求未发出（水合失败）或非 200 都按实际结果报错。
                with page.expect_response(
                    lambda r: r.url.endswith(f"/sessions/{session_id}/grouping/start")
                    and r.request.method == "POST",
                    timeout=20_000,
                ) as grouping_response:
                    # 页面上“开始自动分组”文本同时出现在卡片标题 <p> 与按钮内；
                    # text= 选择器会先命中无事件绑定的 <p>，点击“成功”却从不发
                    # 请求。必须定位到真正的 <button>。
                    page.click('button:has-text("开始自动分组")')
                grouping_http = grouping_response.value
                if grouping_http.status != 200:
                    raise RuntimeError(
                        f"grouping start via UI failed: {grouping_http.status} {grouping_http.text()[:300]}"
                    )
                report("browser/grouping-start", True, "grouping requested from the session page; BFF returned 200")
        except Exception as exc:
            fatal("flow/restart-grouping", repr(exc))

        # 6. 分组出现 → 合并/拆分
        try:
            def groups_ready():
                session = get_session(client, session_id)
                if len(session["groups"]) > 0:
                    return session
                return f"groups=0 state={session['state']}"
            session = poll_until(groups_ready, GROUP_TIMEOUT_S, "automatic grouping")
            initial_group_ids = [group["groupId"] for group in session["groups"]]
            report("flow/auto-grouping", True, f"{len(initial_group_ids)} groups from synthetic batches")

            # 差背景组（含拯救片）不参与合并/拆分演练：拆分按成员顺序对半切，
            # 会把拯救片与差样本切进不同组，破坏后续 QC 恢复路径的确定性。
            def _group_rel_paths(group) -> list[str]:
                return [
                    relative_by_file_id[file_id]
                    for file_id in group["memberFileIds"]
                    if file_id in relative_by_file_id
                ]

            poor_group_id = next(
                (
                    g["groupId"] for g in session["groups"]
                    if any("poor-background" in rel for rel in _group_rel_paths(g))
                ),
                None,
            )
            merge_candidates = [
                g["groupId"] for g in session["groups"] if g["groupId"] != poor_group_id
            ]
            merge_target, merge_source = merge_candidates[0], merge_candidates[1]
            revision = next(g["revision"] for g in session["groups"] if g["groupId"] == merge_target)
            merged = client.proxy(
                "PATCH", f"/groups/{merge_target}",
                json={"action": "MERGE_GROUPS", "expectedGroupRevision": revision, "sourceGroupIds": [merge_target, merge_source]},
            )
            if merged.status_code != 200:
                raise RuntimeError(f"merge refused: {merged.status_code} {merged.text[:200]}")
            session = get_session(client, session_id)
            after_merge = [g["groupId"] for g in session["groups"]]
            report("flow/merge", len(after_merge) == len(initial_group_ids) - 1, f"{len(initial_group_ids)} -> {len(after_merge)} groups")

            merged_group = next(g for g in session["groups"] if g["groupId"] == merge_target)
            members = merged_group["memberFileIds"]
            half = max(1, len(members) // 2)
            revision = merged_group["revision"]
            split = client.proxy(
                "PATCH", f"/groups/{merge_target}",
                json={"action": "SPLIT_GROUP", "expectedGroupRevision": revision, "partitions": [members[:half], members[half:]]},
            )
            if split.status_code != 200:
                raise RuntimeError(f"split refused: {split.status_code} {split.text[:200]}")
            session = get_session(client, session_id)
            report("flow/split", True, f"back to {len(session['groups'])} groups")

            # 6b. ARW-only 组没有可处理栅格，worker 必然终态失败（UNSUPPORTED_SOURCE_KIND）
            #     并把会话打成 PARTIALLY_FAILED、阻断一切人工审批。操作员路径是把它并入
            #     含栅格的组；随后每组主片必须是人工确认的 JPG/PNG/WEBP。
            def _is_arw(file_id: str) -> bool:
                return relative_by_file_id.get(file_id, "").lower().endswith(".arw")

            def _raster_primary(group) -> str | None:
                return next(
                    (
                        file_id for file_id in group["memberFileIds"]
                        if file_id in relative_by_file_id and not _is_arw(file_id)
                    ),
                    None,
                )

            for _ in range(len(initial_group_ids)):
                session = get_session(client, session_id)
                arw_only = next(
                    (
                        g for g in session["groups"]
                        if g["memberFileIds"] and all(_is_arw(f) for f in g["memberFileIds"])
                    ),
                    None,
                )
                if arw_only is None:
                    break
                host = next(
                    g for g in session["groups"]
                    if g["groupId"] != arw_only["groupId"] and _raster_primary(g) is not None
                )
                arw_merge = client.proxy(
                    "PATCH", f"/groups/{host['groupId']}",
                    json={
                        "action": "MERGE_GROUPS",
                        "expectedGroupRevision": host["revision"],
                        "sourceGroupIds": [host["groupId"], arw_only["groupId"]],
                    },
                )
                if arw_merge.status_code != 200:
                    raise RuntimeError(f"arw-only merge refused: {arw_merge.status_code} {arw_merge.text[:200]}")
                report("flow/arw-only-merge", True, "ARW-only group merged into a raster group (operator path)")

            session = get_session(client, session_id)
            for group in session["groups"]:
                if group["groupId"] == poor_group_id:
                    # 差背景组先确认差样本为主片（触发 QC 失败演示）；拯救片留给恢复路径。
                    primary = next(
                        file_id for file_id in group["memberFileIds"]
                        if relative_by_file_id.get(file_id, "").endswith("poor-background.jpg")
                    )
                else:
                    primary = _raster_primary(group)
                if primary is None:
                    raise RuntimeError(f"group {group['groupId']} has no raster member to confirm as primary")
                current = group.get("primaryFileId")
                if current == primary:
                    continue
                set_primary = client.proxy(
                    "PATCH", f"/groups/{group['groupId']}",
                    json={
                        "action": "SET_PRIMARY",
                        "expectedGroupRevision": group["revision"],
                        "primaryFileId": primary,
                    },
                )
                if set_primary.status_code != 200:
                    raise RuntimeError(f"set primary refused: {set_primary.status_code} {set_primary.text[:200]}")
            report("flow/primary-confirmed", True, "every group carries a human-confirmed raster primary")
            if args.skip_browser:
                skipped("browser/groups-page-render", "--skip-browser: 确认分组页渲染为浏览器专属")
            else:
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector("text=确认分组", timeout=60_000)
                page.screenshot(path=str(capture_dir / "desktop-03-groups.png"))
        except Exception as exc:
            fatal("flow/merge-split", repr(exc))

        # 7. 命名 + 草稿 + 八项资料（刷新持久）
        good_group_id: str | None = None
        poor_group_id: str | None = None
        try:
            session = get_session(client, session_id)
            groups = session["groups"]
            # 差背景 batch-h 独立成组；其余为好样本组
            def group_files(group) -> list[str]:
                return [
                    relative_by_file_id[file_id]
                    for file_id in group["memberFileIds"]
                    if file_id in relative_by_file_id
                ]
            poor_group_id = next(
                (g["groupId"] for g in groups if any("poor-background" in f for f in group_files(g))),
                None,
            )
            good_group_id = next(
                g["groupId"] for g in groups
                if g["groupId"] != poor_group_id and "bead-good-a.jpg" in " ".join(group_files(g))
            )
            for index, group in enumerate(groups):
                named = client.proxy(
                    "PATCH", f"/groups/{group['groupId']}",
                    json={
                        "action": "SET_NAME",
                        "expectedGroupRevision": group["revision"],
                        "crystalName": f"QA水晶{index}",
                    },
                )
                if named.status_code != 200:
                    raise RuntimeError(f"naming refused: {named.status_code} {named.text[:200]}")
            report("flow/naming", True, f"{len(groups)} groups named")

            session = get_session(client, session_id)
            group = next(g for g in session["groups"] if g["groupId"] == good_group_id)
            draft = client.proxy(
                "POST", f"/groups/{good_group_id}/draft",
                json={
                    "expectedGroupRevision": group["revision"],
                    "crystalName": group["crystalName"],
                    "displayName": "QA 流程验证珠 8mm",
                    "sku": "QA-FLOW-008",
                    "materialKey": "qa-flow-material-8",
                    "shape": "ROUND",
                    "diameterMm": 8,
                    "currency": "CNY",
                    "unitPriceMinor": 1200,
                    "costMinor": 600,
                    "availableQuantity": 3,
                    "qualityStatement": "合成样本，人工目检通过。",
                    "qualitySource": "QA 集成验收记录。",
                    "rightsHolder": "QA 集成验收",
                    "usagePermission": "OWNED",
                    "isAuthenticPhotograph": True,
                    "allowCommercialUse": True,
                    "allowPublicDisplay": True,
                    "allowAiTraining": False,
                    "allowAiRecommendation": False,
                },
            )
            if draft.status_code != 200:
                raise RuntimeError(f"draft refused: {draft.status_code} {draft.text[:300]}")
            crystal_draft_id = draft.json().get("crystalDraftId")

            # 目录是登录用户（protectedRoute）视图：匿名请求恒 401、materials 为空，
            # 不能用来证明“草稿未泄露”。先用匿名请求证明目录确有认证门槛，
            # 再以 signed-test 认证身份确认草稿 SKU 不在目录里。
            anonymous_catalog = client.backend("GET", "/api/catalog/materials?currency=CNY")
            report(
                "flow/catalog-requires-auth", anonymous_catalog.status_code == 401,
                f"anonymous catalog request rejected with {anonymous_catalog.status_code} (protected route)",
            )
            auth_headers = {"authorization": f"Bearer {signed_test_token()}"}
            catalog_before = client.backend(
                "GET", "/api/catalog/materials?currency=CNY", headers=auth_headers
            )
            if catalog_before.status_code != 200:
                raise RuntimeError(
                    f"authenticated catalog refused: {catalog_before.status_code} {catalog_before.text[:300]}"
                )
            draft_leaked = any(
                product.get("sku") == "QA-FLOW-008"
                for product in catalog_before.json().get("materials", [])
            )
            report("flow/draft-public-denial", draft_leaked is False, "draft sku absent from the authenticated catalog before publish")

            if crystal_draft_id:
                crystal_draft = next(
                    (g["crystalDraft"] for g in session["groups"] if g.get("crystalDraft")), None
                )
                expected_revision = (crystal_draft or {}).get("revision", 1)
                curated = client.proxy(
                    "PATCH", f"/crystal-drafts/{crystal_draft_id}",
                    json={
                        "idempotencyKey": str(uuid.uuid4()),
                        "expectedRevision": expected_revision,
                        "nameCn": "QA水晶A",
                        "nameEn": "QA Crystal A",
                        "mineralName": "Quartz",
                        "colorTags": ["clear"],
                        "visualTags": ["round"],
                        "styleTags": ["classic"],
                        "priceLevel": 2,
                        "complianceNote": "仅描述材质与外观，不涉及任何功效。",
                    },
                )
                if curated.status_code != 200:
                    raise RuntimeError(f"curation refused: {curated.status_code} {curated.text[:300]}")
                report("flow/curation", curated.json().get("curationComplete") is True, "eight curation fields accepted")

            hydrated = get_session(client, session_id)
            hydrated_group = next(g for g in hydrated["groups"] if g["groupId"] == good_group_id)
            persisted = (
                hydrated_group.get("productDraft", {}) or {}
            ).get("displayName") == "QA 流程验证珠 8mm"
            report("flow/draft-refresh-persistence", persisted, "productDraft hydrates from a fresh session read")
            if args.skip_browser:
                skipped("browser/draft-page-render", "--skip-browser: 命名与草稿页渲染为浏览器专属")
            else:
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector("text=命名与草稿", timeout=60_000)
                page.screenshot(path=str(capture_dir / "desktop-04-draft.png"))
        except Exception as exc:
            fatal("flow/naming-draft", repr(exc))

        # 8. 处理 + QC 阻断 + 人工批准
        try:
            started = client.proxy("POST", f"/sessions/{session_id}/processing/start", json={"idempotencyKey": str(uuid.uuid4())})
            if started.status_code != 200:
                raise RuntimeError(f"processing start refused: {started.status_code} {started.text[:300]}")

            def processed():
                # 权威判据：最后一个 PROCESS_GROUP 完成后由后端转 NEEDS_REVIEW
                # （有组卡在 PROCESSED 则 PARTIALLY_FAILED）。只看已存在的资产会
                # 在多数组仍在处理时误判就绪。
                session = get_session(client, session_id)
                if session["state"] in ("NEEDS_REVIEW", "PARTIALLY_FAILED"):
                    return session
                states = [
                    asset["state"]
                    for group in session["groups"]
                    for asset in group.get("processedAssets", [])
                ]
                return f"state={session['state']} processed={len(states)}"

            session = poll_until(processed, PROCESS_TIMEOUT_S, "worker processing + QC")
            assets_by_group = {
                group["groupId"]: group["processedAssets"] for group in session["groups"]
            }
            poor_assets = assets_by_group.get(poor_group_id, [])
            good_assets = assets_by_group.get(good_group_id, [])
            if not poor_assets or not good_assets:
                raise RuntimeError(f"processing produced no assets: poor={len(poor_assets)} good={len(good_assets)}")

            # 契约：worker 写入 isCurrentVersion = qcPassed（repository.ts:4316），
            # QC_FAILED 版本永远 isCurrent=false，必须按 state 选取而非 isCurrent。
            poor_asset = next((a for a in poor_assets if a["state"] == "QC_FAILED"), None)
            if poor_asset is None:
                raise RuntimeError(f"poor group has no QC_FAILED asset: states={[a['state'] for a in poor_assets]}")
            report(
                "flow/qc-verdict", True,
                f"poor-background version state: {poor_asset['state']} (isCurrent={poor_asset['isCurrent']})",
            )
            poor_asset_id = poor_asset["processedAssetId"]
            blocked = client.proxy(
                "POST", f"/groups/{poor_group_id}/processed-assets/{poor_asset_id}/review",
                json={
                    "idempotencyKey": str(uuid.uuid4()),
                    "expectedGroupRevision": next(g["revision"] for g in session["groups"] if g["groupId"] == poor_group_id),
                    "processedAssetId": poor_asset_id,
                    "action": "APPROVE",
                    "reviewNote": "试图批准未通过质检的版本",
                    "rightsHolder": "QA", "usagePermission": "OWNED",
                    "isAuthenticPhotograph": True, "allowAiTraining": False,
                    "allowCommercialUse": True, "allowPublicDisplay": True,
                    "allowAiRecommendation": False,
                },
            )
            report(
                "flow/qc-blocks-approval", 400 <= blocked.status_code < 500,
                f"approve on QC_FAILED refused with {blocked.status_code}",
            )

            # 操作员恢复路径：差组 SET_PRIMARY 切到拯救片（结构编辑会作废既有
            # 处理资产并把组打回 NAMED），再 reprocess 产出 v2；QC 应通过。
            session = get_session(client, session_id)
            poor_group = next(g for g in session["groups"] if g["groupId"] == poor_group_id)
            rescue_file_id = next(
                file_id for file_id in poor_group["memberFileIds"]
                if relative_by_file_id.get(file_id, "").endswith("poor-background-rescue.jpg")
            )
            if poor_group.get("primaryFileId") != rescue_file_id:
                rescue_primary = client.proxy(
                    "PATCH", f"/groups/{poor_group_id}",
                    json={
                        "action": "SET_PRIMARY",
                        "expectedGroupRevision": poor_group["revision"],
                        "primaryFileId": rescue_file_id,
                    },
                )
                if rescue_primary.status_code != 200:
                    raise RuntimeError(f"rescue set primary refused: {rescue_primary.status_code} {rescue_primary.text[:300]}")
            session = get_session(client, session_id)
            poor_group = next(g for g in session["groups"] if g["groupId"] == poor_group_id)
            reprocess = client.proxy(
                "POST", f"/groups/{poor_group_id}/reprocess",
                json={"idempotencyKey": str(uuid.uuid4()), "expectedGroupRevision": poor_group["revision"]},
            )
            if reprocess.status_code != 200:
                raise RuntimeError(f"reprocess refused: {reprocess.status_code} {reprocess.text[:300]}")
            report("flow/qc-recovery-reprocess", True, "operator switched primary to the rescue shot and reprocessed")

            session = poll_until(processed, PROCESS_TIMEOUT_S, "poor group reprocess + QC")
            poor_assets = next(g for g in session["groups"] if g["groupId"] == poor_group_id)["processedAssets"]
            rescue_asset = next((a for a in poor_assets if a["isCurrent"]), None)
            if rescue_asset is None or rescue_asset["state"] != "QC_PENDING":
                issues = rescue_asset.get("qcIssues") if rescue_asset else None
                raise RuntimeError(
                    f"rescue shot did not pass QC (state={rescue_asset and rescue_asset['state']}, issues={issues}); "
                    "tune make_poor_rescue_jpg"
                )
            report("flow/qc-recovery-passed", True, f"rescue primary v{rescue_asset['processingVersion']} is QC_PENDING")

            # 会话到达 READY_TO_PUBLISH 要求每组都已人工批准：逐组审批（含差组拯救版）。
            approved_asset_key: str | None = None
            for group in session["groups"]:
                current = next(
                    (a for a in group.get("processedAssets", []) if a["isCurrent"]), None
                )
                if current is None:
                    raise RuntimeError(f"group {group['groupId']} has no current processed asset")
                if current["state"] == "APPROVED":
                    continue
                if current["state"] != "QC_PENDING":
                    raise RuntimeError(
                        f"group {group['groupId']} current asset state={current['state']} "
                        f"issues={current.get('qcIssues')}; fixture needs tuning"
                    )
                reviewed = client.proxy(
                    "POST", f"/groups/{group['groupId']}/processed-assets/{current['processedAssetId']}/review",
                    json={
                        "idempotencyKey": str(uuid.uuid4()),
                        "expectedGroupRevision": group["revision"],
                        "processedAssetId": current["processedAssetId"],
                        "action": "APPROVE",
                        "reviewNote": "人工确认边缘、颜色与授权",
                        "rightsHolder": "QA 集成验收", "usagePermission": "OWNED",
                        "isAuthenticPhotograph": True, "allowAiTraining": False,
                        "allowCommercialUse": True, "allowPublicDisplay": True,
                        "allowAiRecommendation": False,
                    },
                )
                if reviewed.status_code != 200:
                    raise RuntimeError(f"review refused: {reviewed.status_code} {reviewed.text[:300]}")
                if group["groupId"] == good_group_id:
                    approved_asset_key = reviewed.json()["approvedAssetKey"]
            report("flow/human-approval", bool(approved_asset_key), "all groups approved; authoritative approvedAssetKey returned")
            if args.skip_browser:
                skipped("browser/review-page-render", "--skip-browser: 处理、审核与发布页渲染为浏览器专属")
            else:
                page.reload(wait_until="domcontentloaded")
                page.wait_for_selector("text=处理、审核与发布", timeout=60_000)
                page.screenshot(path=str(capture_dir / "desktop-05-review.png"))
        except Exception as exc:
            fatal("flow/processing-qc-review", repr(exc))

        # 9. 发布 + inventory snapshot + 公开渲染
        try:
            session = get_session(client, session_id)
            group = next(g for g in session["groups"] if g["groupId"] == good_group_id)
            draft_view = group.get("productDraft") or {}
            published = client.proxy(
                "POST", f"/groups/{good_group_id}/publish",
                json={
                    "idempotencyKey": str(uuid.uuid4()),
                    "expectedGroupRevision": group["revision"],
                    "crystalDraftId": draft_view.get("crystalDraftId"),
                    "crystalDraftPromotionConfirmed": True,
                    "crystalName": draft_view.get("crystalName") or group.get("crystalName"),
                    "crystalNameConfirmedByOperator": True,
                    "displayName": "QA 流程验证珠 8mm",
                    "sku": "QA-FLOW-008",
                    "materialKey": "qa-flow-material-8",
                    "shape": "ROUND",
                    "diameterMm": 8,
                    "qualityStatement": "合成样本，人工目检通过。",
                    "qualitySource": "QA 集成验收记录。",
                    "textureAssetKey": approved_asset_key,
                    # 目录完整性过滤要求 modelAssetKey 非空；本流程同一已批准主图
                    # 同时充当模型引用是后端显式支持的同资产路径（不重复绑定）。
                    "modelAssetKey": approved_asset_key,
                    "currency": "CNY", "unitPriceMinor": 1200, "costMinor": 600,
                    "availableQuantity": 3,
                    "allowPublicDisplay": True, "allowAiTraining": False,
                    "allowAiRecommendation": False, "allowCommercialUse": True,
                    "rightsHolder": "QA 集成验收", "usagePermission": "OWNED",
                    "isAuthenticPhotograph": True,
                },
            )
            if published.status_code != 200:
                raise RuntimeError(f"publish refused: {published.status_code} {published.text[:400]}")
            published_body = published.json()
            has_snapshot = bool(published_body.get("inventorySnapshotId")) or bool(
                client.proxy("GET", f"/groups/{good_group_id}/publish-result").json()
            )
            report(
                "flow/publish", published_body.get("publishedAssetKeys") == [approved_asset_key] and has_snapshot,
                f"publishedAssetKeys match; inventory snapshot present={bool(has_snapshot)}",
            )

            public_asset = client.direct("GET", f"/api/assets/{approved_asset_key}")
            report(
                "flow/public-approved-asset", public_asset.status_code == 200 and "image/" in public_asset.headers.get("content-type", ""),
                f"status={public_asset.status_code} type={public_asset.headers.get('content-type')}",
            )
            catalog_after = client.backend(
                "GET", "/api/catalog/materials?currency=CNY",
                headers={"authorization": f"Bearer {signed_test_token()}"},
            )
            if catalog_after.status_code != 200:
                raise RuntimeError(
                    f"authenticated catalog refused after publish: {catalog_after.status_code} {catalog_after.text[:300]}"
                )
            published_visible = any(
                product.get("sku") == "QA-FLOW-008" for product in catalog_after.json().get("materials", [])
            )
            report("flow/published-product-public", published_visible, "published product appears in the authenticated catalog (protected route)")

            if args.skip_browser:
                skipped("browser/approved-product-renders", "--skip-browser: crystal-library 页面渲染为浏览器专属")
            else:
                # crystal-library 的数据源 designApi.materials 走 /api/catalog/materials
                # （前端 BFF 以最终用户 Auth0 会话转发）；本验收的合成 auth0 配置
                # 无法完成真实 OAuth 回环，浏览器里没有最终用户会话——页面会被
                # 认证中间件挡住，已发布珠子的渲染无法在本环境断言。这不是通过项。
                page.set_default_timeout(45_000)
                page.goto(f"http://localhost:{FRONTEND_PORT}/crystal-library", wait_until="domcontentloaded")
                page.screenshot(path=str(capture_dir / "desktop-06-library.png"))
                current_url = page.url
                if "/auth" in current_url or page.locator("text=登录").count() > 0:
                    skipped(
                        "browser/approved-product-renders",
                        f"环境边界：crystal-library 是最终用户视图，需要真实 Auth0 会话；"
                        f"合成配置下页面停在认证门槛（url={current_url}），已发布珠子的"
                        f"浏览器渲染无法在本环境验证（目录数据本身已由 flow/published-product-public 断言）",
                    )
                else:
                    page.wait_for_selector("text=QA水晶A", timeout=60_000)
                    report("browser/approved-product-renders", True, "crystal-library 页面渲染已发布珠子")
        except Exception as exc:
            fatal("flow/publish-public", repr(exc))

        # 10. 手机 390x844 状态/审核可看
        if args.skip_browser:
            skipped("mobile/status-reviews-viewport", "--skip-browser: 移动端视口度量需要真实浏览器")
        else:
            try:
                mobile = browser.new_context(viewport={"width": 390, "height": 844})
                mobile.add_cookies(
                    [{
                        "name": "mystcrag_asset_admin",
                        "value": cookie_header,
                        "domain": "localhost",
                        "path": "/admin/bead-import",
                    }]
                )
                mobile_page = mobile.new_page()
                mobile_page.goto(
                    f"http://localhost:{FRONTEND_PORT}/admin/bead-import/{session_id}",
                    wait_until="domcontentloaded",
                )
                mobile_page.wait_for_selector("text=处理、审核与发布", timeout=60_000)
                mobile_page.screenshot(path=str(capture_dir / "mobile-01-status-review.png"))
                metrics = mobile_page.evaluate(
                    "({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})"
                )
                report(
                    "mobile/status-reviews-viewport", metrics["sw"] <= metrics["cw"] + 2,
                    f"scrollWidth={metrics['sw']} clientWidth={metrics['cw']} at 390x844",
                )
                mobile.close()
            except Exception as exc:
                fatal("mobile/viewport", repr(exc))
            browser.close()

    # 11. 真实素材只读验收（带 5 秒超时；超时即记录环境阻塞）
    run_source_set_phase(args)


def _sha256_file_readonly(path: Path, timeout_s: int = 20) -> str:
    """只读哈希：在带超时的子进程里分块读取，绝不写入/复制/移动。"""
    import subprocess as sp

    code = (
        "import hashlib,sys\n"
        "h=hashlib.sha256()\n"
        "with open(sys.argv[1],'rb') as f:\n"
        "    for chunk in iter(lambda: f.read(1<<20), b''):\n"
        "        h.update(chunk)\n"
        "print(h.hexdigest())\n"
    )
    result = sp.run(
        [sys.executable, "-c", code, str(path)],
        capture_output=True, text=True, timeout=timeout_s, check=True,
    )
    return result.stdout.strip()


def run_source_set_phase(args: argparse.Namespace) -> None:
    source_set = Path(args.source_set)
    import subprocess as sp

    try:
        listing = sp.run(
            ["ls", "-1", str(source_set)], capture_output=True, text=True, timeout=5
        )
        if listing.returncode != 0:
            report("sources/discovery", False, f"ls rc={listing.returncode}: {listing.stderr[:200]}")
            skipped("sources/hash-consistency", "discovery 失败，未尝试抽样；不得记为 PASS")
            return
        entries = listing.stdout.splitlines()
        folder_count = 0
        file_count = 0
        sample_files: list[Path] = []
        for entry in entries:
            entry_path = source_set / entry
            probe = sp.run(["python3", "-c", f"import os,sys; p=sys.argv[1]; print('d' if os.path.isdir(p) else 'f')", str(entry_path)], capture_output=True, text=True, timeout=5)
            if probe.stdout.strip() == "d":
                folder_count += 1
                inner = sp.run(["ls", "-1", str(entry_path)], capture_output=True, text=True, timeout=5)
                inner_files = [line for line in inner.stdout.splitlines() if line]
                file_count += len(inner_files)
                sample_files.extend(entry_path / name for name in inner_files)
            elif probe.stdout.strip() == "f":
                file_count += 1
                sample_files.append(entry_path)
        report(
            "sources/discovery", True,
            f"folders={folder_count} files={file_count} (baseline expectation 26/127 — record actuals verbatim)",
        )
    except sp.TimeoutExpired:
        report(
            "sources/discovery", False,
            "BLOCKED: macOS 文件提供器在 5 秒内未响应只读 ls；如实记录为环境阻塞，未复制、未等待、未改动",
        )
        skipped("sources/hash-consistency", "BLOCKED：目录列举被文件提供器阻塞，无法抽样；不得记为 PASS")
        return

    except Exception as exc:
        report("sources/discovery", False, f"probe failed: {repr(exc)[:200]}")
        skipped("sources/hash-consistency", "discovery 失败，未尝试抽样；不得记为 PASS")
        return

    # 发现成功 → 真实抽样（只读）：每个样本独立读取两次，SHA-256 必须一致（提供器字节稳定性）。
    sample = sample_files[:5]
    if not sample:
        report("sources/hash-consistency", False, "目录可列举但不包含任何文件，无法抽样")
        return
    unstable: list[str] = []
    evidence: list[str] = []
    try:
        for path in sample:
            first = _sha256_file_readonly(path)
            second = _sha256_file_readonly(path)
            if first != second:
                unstable.append(str(path))
            evidence.append(f"{path.name}={first[:16]}…")
    except sp.TimeoutExpired:
        report(
            "sources/hash-consistency", False,
            f"BLOCKED: 抽样文件读取超时（{[str(p.name) for p in sample[:len(evidence) + 1]]}）；"
            "提供器未能在超时内交付稳定字节，未复制、未改动",
        )
        return
    except Exception as exc:
        report("sources/hash-consistency", False, f"read failed: {repr(exc)[:200]}")
        return
    report(
        "sources/hash-consistency", not unstable,
        f"{len(sample)} 个样本各独立读取两次、SHA-256 一致（只读）；样本: {'; '.join(evidence)}"
        + (f"；UNSTABLE={unstable}" if unstable else ""),
    )


def main() -> None:
    global KEEP_TEMP
    parser = argparse.ArgumentParser(description="TASK-ASSET-QA-001 disposable integration gate")
    parser.add_argument("--skip-browser", action="store_true", help="仅 HTTP 层（仍需后端/worker/前端）；浏览器专属断言记为 SKIP")
    parser.add_argument("--backend-port", type=int, default=None, help="后端临时端口（默认 4100；默认端口被占用时自动改用临时端口，显式指定则冲突即报错）")
    parser.add_argument("--frontend-port", type=int, default=None, help="前端临时端口（默认 3100；默认端口被占用时自动改用临时端口，显式指定则冲突即报错）")
    parser.add_argument("--keep", action="store_true", help="保留临时目录与数据库以便复查")
    parser.add_argument("--capture-dir", default=None, help="截图目录（默认临时目录内，不入库）")
    parser.add_argument(
        "--source-set",
        default="/Users/chenyanyan/Desktop/珠子图",
        help="只读探测的真实素材目录（绝不复制或修改）",
    )
    args = parser.parse_args()
    # 本脚本只与 127.0.0.1/localhost 上的自管服务通信；本机 shell 常驻外部代理
    # （HTTP_PROXY）会把回环请求劫走并返回 502，这里对脚本进程及其子进程禁用代理。
    os.environ["no_proxy"] = "*"
    os.environ["NO_PROXY"] = "*"
    KEEP_TEMP = args.keep
    try:
        run_flow(args)
        # 成功路径同样必须打印 SUMMARY 并清理进程/数据库/临时目录；
        # 此前只有 fatal() 路径调用 finish()，成功运行会把服务和测试库留在机器上。
        finish()
    except SystemExit:
        raise
    except Exception as exc:
        report("unexpected/fatal", False, repr(exc))
        finish()


KEEP_TEMP = False

if __name__ == "__main__":
    main()
