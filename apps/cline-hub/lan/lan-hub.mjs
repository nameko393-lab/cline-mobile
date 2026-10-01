#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
/**
 * Cline Hub LAN server
 * ---------------------------------------------------------------------------
 * Runs the official Cline Hub dashboard (apps/cline-hub/src/server.ts) bound to
 * 0.0.0.0 so a phone on the same LAN can drive the sessions that the desktop
 * Cline app registered on the *production* local hub.
 *
 * Hard requirements established by measurement (see README.md):
 *  - The dashboard must run WITHOUT CLINE_BUILD_ENV=development, otherwise it
 *    joins the dev hub (ws://127.0.0.1:25466/hub) and not the desktop's hub
 *    (ws://127.0.0.1:25463/hub).
 *  - With HOST=0.0.0.0 the dashboard only accepts the Host/Origin of PUBLIC_URL,
 *    so PUBLIC_URL must be exactly the LAN URL the phone opens.
 *  - ROOM_SECRET is mandatory for a non-local bind.
 *
 * Commands: start | stop | restart | status | url | doctor | firewall | logs
 */
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, "config.json");
const RUN_DIR = join(HERE, "run");
const LOG_DIR = join(HERE, "logs");
const PID_PATH = join(RUN_DIR, "dashboard.pid");
const DASH_LOG = join(LOG_DIR, "dashboard.log");
const LOCAL_PID_PATH = join(RUN_DIR, "dashboard-local.pid");
const LOCAL_DASH_LOG = join(LOG_DIR, "dashboard-local.log");

/** Each mode (lan / local) owns its own pid + log files. */
function pathsFor(mode) {
	return mode === "local"
		? { pidPath: LOCAL_PID_PATH, logPath: LOCAL_DASH_LOG }
		: { pidPath: PID_PATH, logPath: DASH_LOG };
}

/**
 * Locate the Cline checkout. Priority:
 *  1. config.json "repo"
 *  2. CLINE_REPO env
 *  3. walk up from this script looking for apps/cline-hub/src/server.ts,
 *     which is how it works when the launcher lives at <repo>/apps/cline-hub/lan
 */
function detectRepo() {
	const marker = join("apps", "cline-hub", "src", "server.ts");
	let dir = HERE;
	for (let depth = 0; depth < 8; depth++) {
		if (existsSync(join(dir, marker))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return (process.env.CLINE_REPO ?? "").trim();
}

const DEFAULTS = {
	repo: detectRepo(),
	port: 8787,
	localPort: 8788,
	host: "0.0.0.0",
	// Folder new sessions run in. Created on demand, so a fresh PC needs no setup.
	workspaceRoot:
		(process.env.CLINE_HUB_WORKSPACE ?? "").trim() ||
		join(homedir(), "cline-workspace"),
	publicHost: "",
	// Extra adapters to ignore when auto-picking the LAN IP, e.g. ["172.27.176."]
	lanSkip: [],
	roomSecret: "",
};

/* ------------------------------- config ---------------------------------- */

function loadConfig() {
	let stored = {};
	if (existsSync(CONFIG_PATH)) {
		try {
			stored = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		} catch (error) {
			fail(`config.json が読み込めません: ${error.message}`);
		}
	}
	const config = { ...DEFAULTS, ...stored };
	if (
		!config.repo ||
		!existsSync(join(config.repo, "apps", "cline-hub", "src", "server.ts"))
	) {
		fail(
			`Cline が見つかりません (repo=${config.repo || "未設定"})。\n` +
				"  config.json の repo に Cline チェックアウトのパスを書くか、CLINE_REPO 環境変数を設定してください。",
		);
	}
	if (!config.roomSecret) {
		config.roomSecret = randomBytes(24).toString("base64url");
		saveConfig(config);
	}
	return config;
}

function saveConfig(config) {
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/* -------------------------------- helpers -------------------------------- */

function fail(message) {
	console.error(`[error] ${message}`);
	process.exit(1);
}

function info(message) {
	console.log(message);
}

/**
 * LAN-facing IPv4 addresses. Loopback, APIPA and adapters whose *name* marks
 * them as virtual are dropped. config.lanSkip adds per-machine prefixes (e.g.
 * a Hyper-V switch that reports itself as a plain adapter) so nothing about a
 * specific PC is baked into this file.
 */
function lanAddresses(config = {}) {
	const virtualAdapter =
		/hyper-v|vethernet|v-wsl|\bwsl\b|vmware|virtualbox|virtual|loopback|tailscale|wireguard|isatap|teredo/i;
	const extra = config.lanSkip ?? [];
	const skip = (ip) =>
		ip.startsWith("127.") ||
		ip.startsWith("169.254.") || // APIPA: no DHCP lease
		ip.startsWith("198.18.") || // benchmark range
		extra.some((prefix) => prefix && ip.startsWith(prefix));
	const found = [];
	for (const [name, list] of Object.entries(networkInterfaces())) {
		if (virtualAdapter.test(name)) continue;
		for (const entry of list ?? []) {
			if (entry.family !== "IPv4" && entry.family !== 4) continue;
			if (entry.internal) continue;
			if (skip(entry.address)) continue;
			found.push({ name, address: entry.address });
		}
	}
	const rank = (ip) =>
		ip.startsWith("192.168.")
			? 0
			: ip.startsWith("10.")
				? 1
				: ip.startsWith("172.")
					? 2
					: 3;
	return found.sort((a, b) => rank(a.address) - rank(b.address));
}

function resolvePublicHost(config) {
	const explicit =
		config.publicHost?.trim() || process.env.CLINE_LAN_IP?.trim();
	if (explicit) return explicit;
	const lan = lanAddresses(config)[0];
	if (!lan)
		fail(
			"LAN の IPv4 が見つかりません。config.json の publicHost を設定してください。",
		);
	return lan.address;
}

const publicUrl = (config, host) => `http://${host}:${config.port}`;
const inviteUrl = (config, host) =>
	`${publicUrl(config, host)}/?roomSecret=${config.roomSecret}`;

function hubRecordPath() {
	const base =
		process.env.CLINE_DIR?.trim() ||
		join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".cline");
	return join(base, "data", "locks", "hub", "production.json");
}

function readHubRecord() {
	const path = hubRecordPath();
	if (!existsSync(path)) return { path, missing: true };
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return { path, url: raw.url, pid: raw.pid, coreVersion: raw.coreVersion };
	} catch (error) {
		return { path, error: error.message };
	}
}

function findBun() {
	// process.execPath only counts when it really is bun: running this launcher
	// with `node lan-hub.mjs` must not hand node.exe to `spawn(..., ["run", ...])`.
	const isBun = (path) => basename(path ?? "").toLowerCase().startsWith("bun");
	const candidates = [
		isBun(process.execPath) ? process.execPath : "",
		join(
			process.env.APPDATA ?? "",
			"npm",
			"node_modules",
			"bun",
			"bin",
			"bun.exe",
		),
		join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"),
	];
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate;
	}
	fail("bun が見つかりません。npm install -g bun@1.4.2 を実行してください。");
}

function readPid(mode = "lan") {
	const { pidPath } = pathsFor(mode);
	if (!existsSync(pidPath)) return undefined;
	const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
	return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function isAlive(pid) {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function fetchHealth(config, host, port = config.port) {
	const response = await fetch(`http://${host}:${port}/health`, {
		headers: { host: `${host}:${port}` },
	});
	if (!response.ok) throw new Error(`health HTTP ${response.status}`);
	return await response.json();
}

async function waitForHealth(
	config,
	host,
	port = config.port,
	timeoutMs = 90_000,
) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			return await fetchHealth(config, host, port);
		} catch {
			await new Promise((r) => setTimeout(r, 1500));
		}
	}
	return undefined;
}

/* ------------------------------ dashboard -------------------------------- */

function spawnDashboard(config, host, mode = "lan") {
	const serverDir = join(config.repo, "apps", "cline-hub");
	const serverEntry = join(serverDir, "src", "server.ts");
	const webviewDist = join(serverDir, "dist", "webview");
	if (!existsSync(serverEntry))
		fail(`dashboard が見つかりません: ${serverEntry}`);
	if (!existsSync(webviewDist))
		fail(
			`webview が未ビルドです: ${webviewDist}\n  → cd apps\\cline-hub && bun run build:webview`,
		);

	// New sessions run in workspaceRoot; create it so a fresh PC needs no setup.
	try {
		mkdirSync(config.workspaceRoot, { recursive: true });
	} catch {
		// Leave it: the hub surfaces the real error if the folder is unusable.
	}

	mkdirSync(RUN_DIR, { recursive: true });
	mkdirSync(LOG_DIR, { recursive: true });

	const local = mode === "local";
	const port = local ? (config.localPort ?? config.port + 1) : config.port;
	const bindHost = local ? "127.0.0.1" : config.host;
	const { pidPath, logPath } = pathsFor(mode);

	const env = { ...process.env };
	// Production build env is what pins us to the hub the desktop app is on.
	delete env.CLINE_BUILD_ENV;
	delete env.NODE_ENV;
	delete env.CLINE_HUB_DISCOVERY_PATH;
	delete env.CLINE_DIR;
	env.HOST = bindHost;
	env.CLINE_HUB_DASHBOARD_PORT = String(port);
	env.WORKSPACE_ROOT = config.workspaceRoot;
	if (local) {
		// Local bind: localhost/127.0.0.1 origins are allowed and no secret is required.
		delete env.ROOM_SECRET;
		env.PUBLIC_URL = `http://127.0.0.1:${port}`;
	} else {
		env.ROOM_SECRET = config.roomSecret;
		env.PUBLIC_URL = publicUrl(config, host);
	}

	const fd = openSync(logPath, "a");
	writeFileSync(
		fd,
		`\n===== start ${mode} ${new Date().toISOString()} =====\n`,
	);
	const child = spawn(findBun(), ["run", "src/server.ts"], {
		cwd: serverDir,
		env,
		detached: true,
		windowsHide: true,
		stdio: ["ignore", fd, fd],
	});
	closeSync(fd);
	if (!child.pid)
		fail("dashboard を起動できませんでした。logs を確認してください。");
	writeFileSync(pidPath, `${child.pid}\n`);
	child.unref();
	return { pid: child.pid, port, bindHost };
}

function killDashboard(pid) {
	if (!pid || !isAlive(pid)) return false;
	const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
		windowsHide: true,
		encoding: "utf8",
	});
	return (result.status ?? 1) === 0;
}

async function printQr(text) {
	try {
		const qr = await import("qrcode");
		info("");
		info(await qr.default.toString(text, { type: "terminal", margin: 1 }));
	} catch {
		/* qrcode is optional */
	}
}

// --- phone UI layer -------------------------------------------------------
// The launcher writes two files into the dashboard's BUILD OUTPUT
// (apps/cline-hub/dist/webview, which is gitignored) and removes them again on
// stop. Cline's tracked source is never modified, so the phone behaviour lives
// entirely inside this launcher.
// The dashboard only serves static files without the roomSecret gate under
// /assets/ (see apps/cline-hub/src/server.ts isPublicStaticAssetPath), so the
// phone layer has to live there — a browser subresource request carries no
// Origin header and would be rejected anywhere else.
const PHONE_UI_FILENAME = "cline-lan-phone-ui.js";
const DASH_UI_FILENAME = "cline-lan-dashboard-ui.js";
const UI_FILENAMES = [PHONE_UI_FILENAME, DASH_UI_FILENAME];

/**
 * Options for the injected tag's query string.
 * `phoneRestore: false` (config) or CLINE_HUB_PHONE_RESTORE=0 disables the
 * checkpoint-restore recovery, leaving only the same-folder fallback.
 * `v=` is the injected file's stamp: browsers cache these scripts, and without
 * it a phone keeps running the previous layer after start has re-injected one.
 */
function uiTag(filename, config) {
	const restoreEnabled =
		config.phoneRestore !== false && process.env.CLINE_HUB_PHONE_RESTORE !== "0";
	const params = new URLSearchParams();
	if (filename === PHONE_UI_FILENAME && !restoreEnabled) params.set("restore", "0");
	const stamp = uiStamp(config, filename);
	if (stamp) params.set("v", stamp);
	const query = params.toString();
	return `<script src="/assets/${filename}${query ? `?${query}` : ""}"></script>`;
}

/** mtime + size of the injected file, as a short cache-busting token. */
function uiStamp(config, filename) {
	const asset = uiPaths(config.repo).assets[UI_FILENAMES.indexOf(filename)];
	if (!asset || !existsSync(asset)) return "";
	try {
		const { mtimeMs, size } = statSync(asset);
		return `${Math.trunc(mtimeMs).toString(36)}${size.toString(36)}`;
	} catch {
		return "";
	}
}

function uiPaths(repo) {
	const dir = join(repo, "apps", "cline-hub", "dist", "webview");
	return {
		index: join(dir, "index.html"),
		assets: UI_FILENAMES.map((filename) => join(dir, "assets", filename)),
	};
}

function phoneUiInstalled(config) {
	const { index, assets } = uiPaths(config.repo);
	if (!existsSync(index)) return false;
	const html = readFileSync(index, "utf8");
	return UI_FILENAMES.every(
		(filename, position) => existsSync(assets[position]) && html.includes(filename),
	);
}

function installPhoneUi(config) {
	const { index, assets } = uiPaths(config.repo);
	if (!existsSync(index)) return "UI layer: 未導入（webview がビルドされていません）";
	mkdirSync(dirname(assets[0]), { recursive: true });
	for (const [position, filename] of UI_FILENAMES.entries()) {
		const source = join(HERE, filename.replace("cline-lan-", ""));
		if (!existsSync(source)) return `UI layer: 未導入（${filename.replace("cline-lan-", "")} が見つかりません）`;
		copyFileSync(source, assets[position]);
	}
	const html = readFileSync(index, "utf8");
	const missing = UI_FILENAMES.filter((filename) => !html.includes(filename));
	if (missing.length) {
		const tags = missing.map((filename) => uiTag(filename, config)).join("\n  ");
		writeFileSync(index, html.replace("</body>", `  ${tags}\n</body>`));
	}
	return "UI layer: 導入済み（スマホ: Enter=改行 / 送信ボタン / session not found 自動復旧 ― 共通: 新規セッションボタン / 名前確定 / 削除確認）";
}

function uninstallPhoneUi(config) {
	const { index, assets } = uiPaths(config.repo);
	if (existsSync(index)) {
		const html = readFileSync(index, "utf8");
		// Match any tag we ever injected, so an older layout is cleaned up too.
		const cleaned = html.replace(
			/[ \t]*<script src="[^"]*cline-lan-[a-z]+-ui\.js(\?[^"]*)?"><\/script>\r?\n?/g,
			"",
		);
		if (cleaned !== html) writeFileSync(index, cleaned);
	}
	for (const asset of assets) {
		if (existsSync(asset)) rmSync(asset, { force: true });
	}
	// Older layout kept the phone file at the webview root.
	const legacy = join(config.repo, "apps", "cline-hub", "dist", "webview", "cline-lan-phone-ui.js");
	if (existsSync(legacy)) rmSync(legacy, { force: true });
	return "UI layer: 解除済み";
}

async function commandStart(config) {
	const host = resolvePublicHost(config);
	const existing = readPid("lan");
	if (existing && isAlive(existing)) {
		info(`既に稼働中です (pid=${existing})`);
		info(`  招待URL: ${inviteUrl(config, host)}`);
		return 0;
	}
	info(installPhoneUi(config));
	const { pid, port } = spawnDashboard(config, host, "lan");
	info(`dashboard 起動中... (pid=${pid})`);
	const health = await waitForHealth(config, host, port);
	if (!health) {
		info("起動を確認できません。logs/dashboard.log を確認してください。");
		return 1;
	}
	const record = readHubRecord();
	const hubUrl = health.address ?? record.url;
	info("");
	info(`  LAN URL : ${publicUrl(config, host)}`);
	info(`  招待URL : ${inviteUrl(config, host)}`);
	info(`  hub     : ${hubUrl}`);
	if (
		record.url &&
		hubUrl &&
		hubUrl.split("?")[0] !== record.url.split("?")[0]
	) {
		info(`  ⚠ デスクトップの hub (${record.url}) と接続先が一致しません。`);
	}
	const desktop = (health.clients ?? []).filter((c) =>
		/desktop|sidecar/i.test(`${c.clientType} ${c.displayName}`),
	);
	info(
		`  clients : ${(health.clients ?? []).length} (desktop: ${desktop.length}) / sessions: ${health.activeSessions ?? 0}`,
	);
	await printQr(inviteUrl(config, host));
	info("");
	info("スマホで招待URLを開いてください（同一LAN・HTTP）。");
	return 0;
}

async function commandStop(config, mode = "lan") {
	const pid = readPid(mode);
	if (!pid) {
		info(`稼働していません（${mode} の pid ファイルなし）。`);
		return 0;
	}
	info(
		killDashboard(pid)
			? `dashboard を停止しました (${mode} pid=${pid})`
			: `停止対象が見つかりません (pid=${pid})`,
	);
	// Drop the pid file so a later start/stop never reports a stale process.
	const { pidPath } = pathsFor(mode);
	if (existsSync(pidPath)) rmSync(pidPath, { force: true });
	info(uninstallPhoneUi(config));
	return 0;
}

async function commandLocal(config) {
	const localPort = config.localPort ?? config.port + 1;
	const existing = readPid("local");
	if (existing && isAlive(existing)) {
		info(`既に稼働中です (pid=${existing}) → http://localhost:${localPort}/`);
		return 0;
	}
	info(installPhoneUi(config));
	const { pid, port } = spawnDashboard(config, "127.0.0.1", "local");
	info(`local dashboard 起動中... (pid=${pid})`);
	const health = await waitForHealth(config, "127.0.0.1", port);
	if (!health) {
		info("起動を確認できません。logs/dashboard-local.log を確認してください。");
		return 1;
	}
	info(`  PC 用 URL : http://localhost:${port}/  ← roomSecret 不要`);
	info(`  hub       : ${health.address}`);
	info("  ※ PC のブラウザ用です。スマホは LAN 招待URLを使ってください。");
	return 0;
}

/* -------------------------------- commands ------------------------------- */

async function commandStatus(config) {
	const host = resolvePublicHost(config);
	const localPort = config.localPort ?? config.port + 1;
	const pid = readPid("lan");
	const localPid = readPid("local");
	info(
		`lan  : pid=${pid && isAlive(pid) ? pid : "停止中"}  bind=${config.host}:${config.port}  publicHost=${host}`,
	);
	info(
		`local: pid=${localPid && isAlive(localPid) ? localPid : "停止中"}  bind=127.0.0.1:${localPort}  → http://localhost:${localPort}/`,
	);
	const record = readHubRecord();
	info(
		`hub record: ${record.missing ? "なし" : `${record.url} (pid=${record.pid ?? "?"})`}`,
	);
	for (const [label, target, port] of [
		["lan", host, config.port],
		["local", "127.0.0.1", localPort],
	]) {
		try {
			const health = await fetchHealth(config, target, port);
			info(
				`${label} health: ${health.status}  connected=${health.connected}  sessions=${health.activeSessions ?? 0}  hub=${health.address}`,
			);
			for (const client of health.clients ?? []) {
				info(
					`  client: ${client.displayName ?? client.clientId} [${client.clientType}]`,
				);
			}
		} catch (error) {
			info(`${label} health: 取得失敗 ${error.message}（未起動の可能性）`);
		}
	}
	return 0;
}

async function commandUrl(config) {
	info(inviteUrl(config, resolvePublicHost(config)));
	await printQr(inviteUrl(config, resolvePublicHost(config)));
	return 0;
}

const POWERSHELL = join(
	process.env.SystemRoot ?? "C:\\Windows",
	"System32",
	"WindowsPowerShell",
	"v1.0",
	"powershell.exe",
);

const firewallRuleName = (port) => `cline-hub-lan-${port}`;

function firewallRuleEnabled(port) {
	const result = spawnSync(
		POWERSHELL,
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Get-NetFirewallRule -Name '${firewallRuleName(port)}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Enabled`,
		],
		{ windowsHide: true, encoding: "utf8" },
	);
	return (result.stdout ?? "").trim().toLowerCase() === "true";
}

/**
 * Is the cline checkout untouched? This launcher never modifies cline code; it
 * only spawns `<repo>/apps/cline-hub/src/server.ts`. A dirty `apps/cline-hub`
 * means someone patched the dashboard, which this tool deliberately avoids.
 */
function clineCheckoutState(config) {
	try {
		const status = spawnSync(
			"git",
			["-C", config.repo, "status", "--porcelain", "--", "apps/cline-hub"],
			{ windowsHide: true, encoding: "utf8" },
		);
		if (status.status !== 0) return "git 確認できず（チェックアウトではない？）";
		const dirty = (status.stdout ?? "")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const head =
			spawnSync("git", ["-C", config.repo, "rev-parse", "--short", "HEAD"], {
				windowsHide: true,
				encoding: "utf8",
			}).stdout?.trim() || "?";
		if (dirty.length === 0) return `無変更（素の状態）HEAD=${head}`;
		const files = dirty.slice(0, 3).map((line) => line.slice(0, 44));
		return `ローカル変更 ${dirty.length} 件: ${files.join(", ")}`;
	} catch {
		return "git 確認できず";
	}
}

/** The hub only treats an explicit `title` as a rename: folding it into
 *  `metadata.title` gets overwritten by the stored title, so the dashboard's
 *  updateSessionMetadata handler has to forward `title` as its own field. */
function sessionRenameState(config) {
	const file = join(config.repo, "apps/cline-hub/src/server.ts");
	if (!existsSync(file)) return "確認できず（dashboard src が見つかりません）";
	let source = "";
	try {
		source = readFileSync(file, "utf8");
	} catch {
		return "確認できず（読取失敗）";
	}
	const start = source.indexOf('frame.type === "updateSessionMetadata"');
	if (start < 0) return "ハンドラなし（リネーム不可）";
	const next = source.indexOf("frame.type ===", start + 40);
	const block = source.slice(start, next < 0 ? source.length : next);
	return block.includes("title")
		? "OK（title を専用フィールドで転送）"
		: "要修正: updateSessionMetadata が title を転送しておらず、リネームが元の名前に戻ります";
}

async function commandDoctor(config) {
	const host = resolvePublicHost(config);
	const record = readHubRecord();
	const rows = [
		["bun", findBun()],
		[
			"dashboard src",
			existsSync(join(config.repo, "apps/cline-hub/src/server.ts"))
				? "OK"
				: "NOT FOUND",
		],
		[
			"webview dist",
			existsSync(join(config.repo, "apps/cline-hub/dist/webview"))
				? "OK"
				: "要ビルド: bun run build:webview",
		],
		[
			"node_modules",
			existsSync(join(config.repo, "node_modules")) ? "OK" : "要 bun install",
		],
		[
			"sdk dist",
			existsSync(join(config.repo, "sdk/packages/core/dist"))
				? "OK"
				: "要 bun run build:sdk",
		],
		[
			"cline checkout",
			clineCheckoutState(config),
		],
		[
			"UI layer",
			phoneUiInstalled(config)
				? "導入済み（スマホ: Enter=改行 / 送信ボタン / session not found 自動復旧 ― 共通: 新規セッションボタン / 名前確定 / 削除確認 / 入力欄 Enter=改行 / 送信ボタン）"
				: "未導入（start でビルド成果物に導入される）",
		],
		["session rename", sessionRenameState(config)],

		[
			"hub record",
			record.missing
				? "なし（desktop 起動時に作られる）"
				: `${record.url} pid=${record.pid ?? "?"}`,
		],
		[
			"LAN candidates",
			lanAddresses(config)
				.map((i) => `${i.address}(${i.name})`)
				.join(", ") || "なし",
		],
		[
			"firewall",
			firewallRuleEnabled(config.port)
				? `${firewallRuleName(config.port)} 許可済み`
				: "未設定: firewall --apply",
		],
	];
	if (record.url) {
		try {
			const u = new URL(record.url);
			const res = await fetch(`http://${u.hostname}:${u.port}/health`);
			rows.push(["hub health", res.ok ? "healthy" : `HTTP ${res.status}`]);
		} catch (error) {
			rows.push(["hub health", `失敗: ${error.message}`]);
		}
	}
	for (const [label, value] of rows) info(`${label.padEnd(18)} : ${value}`);
	info(`invite URL         : ${inviteUrl(config, host)}`);
	return 0;
}

function commandFirewall(config, apply) {
	const script = join(HERE, "install-firewall.ps1");
	if (!apply) {
		info(
			`適用: powershell -ExecutionPolicy Bypass -File "${script}" -Port ${config.port}`,
		);
		info("（管理者権限の UAC プロンプトが出ます）");
		return 0;
	}
	const result = spawnSync(
		POWERSHELL,
		[
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			script,
			"-Port",
			String(config.port),
		],
		{ stdio: "inherit" },
	);
	return result.status ?? 0;
}

function commandLogs(lines) {
	if (!existsSync(DASH_LOG)) {
		info("ログがありません。");
		return 0;
	}
	info(readFileSync(DASH_LOG, "utf8").split(/\r?\n/).slice(-lines).join("\n"));
	return 0;
}

/* -------------------------------- dispatch ------------------------------- */

async function main() {
	const [command = "status", ...rest] = process.argv.slice(2);
	const config = loadConfig();
	switch (command) {
		case "start":
			process.exitCode = await commandStart(config);
			break;
		case "local":
			process.exitCode = await commandLocal(config);
			break;
		case "stop":
			process.exitCode = await commandStop(
				config,
				rest.includes("--local") ? "local" : "lan",
			);
			break;
		case "restart":
			await commandStop(config, rest.includes("--local") ? "local" : "lan");
			await new Promise((r) => setTimeout(r, 1500));
			process.exitCode = rest.includes("--local")
				? await commandLocal(config)
				: await commandStart(config);
			break;
		case "status":
			process.exitCode = await commandStatus(config);
			break;
		case "url":
			process.exitCode = await commandUrl(config);
			break;
		case "doctor":
			process.exitCode = await commandDoctor(config);
			break;
		case "firewall":
			process.exitCode = commandFirewall(config, rest.includes("--apply"));
			break;
		case "logs": {
			const n = Number.parseInt(rest[0] ?? "40", 10);
			process.exitCode = commandLogs(Number.isFinite(n) ? n : 40);
			break;
		}
		default:
			info(
				"使い方: bun lan-hub.mjs <start|local|stop [--local]|restart [--local]|status|url|doctor|firewall [--apply]|logs [行数]>",
			);
			info("  start  … スマホ用（0.0.0.0、roomSecret 必須）");
			info("  local  … PC ブラウザ用（127.0.0.1、roomSecret 不要）");
			process.exitCode = 2;
	}
}

await main();
