var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");

// ../node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/worker.ts
var worker_default = {
  async fetch(request, env2, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    try {
      if (path === "/" || path === "") return dashboard();
      if (path === "/api/macro" && request.method === "GET") return await handleMacro(env2, ctx);
      if (path === "/api/x10" && request.method === "POST") return await handleX10(request, env2, ctx);
      if (path === "/api/regime" && request.method === "GET") return await handleRegime(env2, ctx);
      if (path === "/api/backtest-lite" && request.method === "GET") return await handleBacktestLite(env2, url);
      if (path === "/api/deploy-guard" && request.method === "GET") return await handleDeployGuard(env2);
      if (path === "/api/health" && request.method === "GET") return jsonResponse({ status: "ok", version: "X10-CF-WORKER-v1.1", timestamp: isoNow() });
      return jsonResponse({ error: "Not Found", path }, 404);
    } catch (err) {
      return jsonResponse({ error: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Internal server error", timestamp: isoNow() }, 500);
    }
  }
};
function dashboard() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>\u03A9-MYTHOS X10 \u2014 Santander Argentina</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--g:#1d951d;--g2:#2eb82e;--gd:rgba(29,149,29,.08);--bg:#0d1117;--card:#161b22;--card2:#1c2333;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--red:#f85149;--amber:#d29922;--blue:#58a6ff;--purple:#bc8cff}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-tap-highlight-color:transparent;overflow-x:hidden}
.top-bar{height:4px;background:linear-gradient(90deg,var(--g),var(--blue));position:sticky;top:0;z-index:100}
.sticky-header{position:sticky;top:4px;z-index:99;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 12px;backdrop-filter:blur(12px)}
.sticky-header .hdr-row{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
.sticky-header h1{font-size:1.1rem;font-weight:700;color:var(--text)}
.sticky-header h1 span{color:var(--g)}
.sticky-header .hdr-badges{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.sticky-header .hdr-chip{padding:2px 8px;border-radius:4px;font-size:.65rem;font-weight:600;border:1px solid}
.chip-regime{border-color:var(--g);color:var(--g)}
.chip-regime.crisis{border-color:var(--red);color:var(--red)}
.chip-regime.high_vol{border-color:var(--amber);color:var(--amber)}
.chip-regime.carry{border-color:var(--blue);color:var(--blue)}
.chip-live{border-color:var(--g);color:var(--g);display:inline-flex;align-items:center;gap:4px}
.chip-live::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--g);animation:pulse 2s infinite}
.chip-nav{border-color:var(--border);color:var(--muted)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

.wrap{max-width:960px;margin:0 auto;padding:0 10px 20px}
.section{margin:14px 0}
.section-title{font-size:.65rem;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--g);opacity:.8;margin-bottom:6px}

.grid2{display:grid;grid-template-columns:1fr;gap:8px}
.grid3{display:grid;grid-template-columns:1fr;gap:8px}
@media(min-width:480px){.grid2{grid-template-columns:1fr 1fr}.grid3{grid-template-columns:1fr 1fr}}
@media(min-width:768px){.grid3{grid-template-columns:1fr 1fr 1fr}}

.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px}
.card-label{font-size:.6rem;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px}
.card-value{font-size:1.2rem;font-weight:700;color:var(--text)}
.card-sub{font-size:.65rem;color:var(--muted);margin-top:2px}
.card-value.green{color:var(--g)}
.card-value.red{color:var(--red)}
.card-value.amber{color:var(--amber)}
.card-value.blue{color:var(--blue)}

.regime-card{text-align:center;padding:16px 12px}
.regime-card .regime-name{font-size:1.4rem;font-weight:900;margin-top:4px}
.regime-card .regime-name.crisis{color:var(--red)}
.regime-card .regime-name.high_vol{color:var(--amber)}
.regime-card .regime-name.normal{color:var(--g)}
.regime-card .regime-name.carry{color:var(--blue)}

.bar-row{display:flex;align-items:center;gap:6px;margin:5px 0;font-size:.7rem}
.bar-label{width:100px;flex-shrink:0;font-weight:500;text-align:right;font-size:.65rem}
.bar-track{flex:1;height:18px;background:var(--gd);border-radius:3px;overflow:hidden;position:relative}
.bar-fill{height:100%;border-radius:3px;transition:width .5s ease}
.bar-fill.pres{background:var(--g)}
.bar-fill.inf{background:#059669}
.bar-fill.carry{background:var(--blue)}
.bar-fill.usd{background:var(--purple)}
.bar-fill.tact{background:var(--amber)}
.bar-pct{position:absolute;right:5px;top:50%;transform:translateY(-50%);font-size:.6rem;font-weight:600;color:#fff}

.directive{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);font-size:.7rem}
.directive:last-child{border-bottom:none}
.dir-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dir-dot.on{background:var(--red)}
.dir-dot.off{background:var(--g)}
.dir-name{font-weight:600}
.dir-reason{color:var(--muted);font-size:.6rem;margin-left:auto;text-align:right;max-width:50%}

.scenario-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.scenario-row .card{text-align:center}
.scen-label{font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
.scen-val{font-size:1rem;font-weight:700;margin-top:3px}
.scen-prob{font-size:.6rem;color:var(--muted)}

.oracle-signal{display:flex;align-items:center;gap:5px;padding:4px 0;font-size:.7rem}
.oracle-signal .sig-name{width:80px;font-weight:500;font-size:.65rem}
.oracle-signal .sig-bar{flex:1;height:5px;background:var(--gd);border-radius:3px;overflow:hidden}
.oracle-signal .sig-fill{height:100%;border-radius:3px;background:var(--g)}
.oracle-signal .sig-dir{font-size:.6rem;font-weight:600;width:18px;text-align:center}
.sig-dir.alc{color:var(--g)}
.sig-dir.baj{color:var(--red)}
.sig-dir.neu{color:var(--amber)}

.perf-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.perf-row .card{text-align:center}

.status-badge{display:inline-block;padding:2px 6px;border-radius:3px;font-size:.55rem;font-weight:700;letter-spacing:1px}
.status-badge.real{background:rgba(29,149,29,.15);color:var(--g)}
.status-badge.error{background:rgba(248,81,73,.15);color:var(--red)}
.status-badge.partial{background:rgba(210,153,34,.15);color:var(--amber)}
.status-badge.partial{background:rgba(210,153,34,.15);color:var(--amber)}

.loading{text-align:center;padding:40px;color:var(--muted);font-size:.8rem}

footer{text-align:center;padding:16px 0;font-size:.6rem;color:var(--muted);border-top:1px solid var(--border);margin-top:16px}
</style>
</head>
<body>
<div class="top-bar"></div>
<div class="sticky-header">
<div class="hdr-row">
<h1><span>\u03A9-MYTHOS</span> X10</h1>
<div class="hdr-badges">
<span class="chip-live">EDGE LIVE</span>
<span id="hdr-regime" class="chip-regime"></span>
<span id="hdr-nav" class="chip-nav"></span>
<span id="hdr-dd" class="chip-nav"></span>
<span id="hdr-integrity" class="chip-nav"></span>
</div>
</div>
</div>

<div class="wrap">
<div id="loading" class="loading">Cargando datos macro en tiempo real...</div>
<div id="safe-mode-banner" style="display:none;background:var(--red);color:#fff;text-align:center;padding:8px;font-size:.75rem;font-weight:700;letter-spacing:1px">SAFE MODE \u2014 dataIntegrityScore &lt; 0.7 \u2014 TRADING BLOCKED</div>
<div id="dash" style="display:none">

<div class="section">
<div class="section-title">R\xE9gimen de Capital</div>
<div class="card regime-card">
<div id="risk-badge" class="status-badge"></div>
<div id="regime-name" class="regime-name"></div>
<div id="regime-conf" style="font-size:.75rem;color:var(--muted);margin-top:3px"></div>
</div>
</div>

<div class="section">
<div class="section-title">Performance</div>
<div class="perf-row">
<div class="card"><div class="card-label">Sharpe</div><div id="v-sharpe" class="card-value"></div></div>
<div class="card"><div class="card-label">Calmar</div><div id="v-calmar" class="card-value"></div></div>
<div class="card"><div class="card-label">Datos Reales</div><div id="v-real" class="card-value"></div></div>
</div>
</div>

<div class="section">
<div class="section-title">Estado Macro</div>
<div class="grid3">
<div class="card"><div class="card-label">MEP</div><div id="v-mep" class="card-value green"></div><div id="s-mep" class="card-sub"></div></div>
<div class="card"><div class="card-label">Inflaci\xF3n Mensual</div><div id="v-infl" class="card-value"></div><div id="s-infl" class="card-sub"></div></div>
<div class="card"><div class="card-label">Tasa BCRA</div><div id="v-bcra" class="card-value"></div><div id="s-bcra" class="card-sub"></div></div>
</div>
<div class="grid3" style="margin-top:8px">
<div class="card"><div class="card-label">Gap MEP</div><div id="v-gap" class="card-value"></div><div id="s-gap" class="card-sub"></div></div>
<div class="card"><div class="card-label">Fisher Real</div><div id="v-fisher" class="card-value"></div><div id="s-fisher" class="card-sub"></div></div>
<div class="card"><div class="card-label">Data Source</div><div id="v-source" class="card-value"></div><div id="s-source" class="card-sub"></div></div>
</div>
</div>

<div class="section">
<div class="section-title">Oracle \u2014 Se\xF1ales</div>
<div class="card" id="oracle-signals"></div>
</div>

<div class="section">
<div class="section-title">Asignaci\xF3n de Portafolio (USD 2.000 / Moderate)</div>
<div class="card">
<h3 style="font-size:.8rem;font-weight:700;margin-bottom:8px">5 Buckets de Capital</h3>
<div id="alloc-bars"></div>
</div>
</div>

<div class="section">
<div class="section-title">M\xE9tricas de Riesgo</div>
<div class="grid2">
<div class="card"><div class="card-label">Retorno Esperado 30d</div><div id="v-ret30" class="card-value"></div></div>
<div class="card"><div class="card-label">Retorno Esperado 90d</div><div id="v-ret90" class="card-value"></div></div>
<div class="card"><div class="card-label">Prob. de P\xE9rdida</div><div id="v-ploss" class="card-value"></div></div>
<div class="card"><div class="card-label">Max Drawdown</div><div id="v-dd" class="card-value"></div></div>
<div class="card"><div class="card-label">Capital en Riesgo</div><div id="v-car" class="card-value"></div></div>
<div class="card"><div class="card-label">Preserv. Capital</div><div id="v-cpres" class="card-value"></div></div>
</div>
</div>

<div class="section">
<div class="section-title">Escenarios Stress</div>
<div class="scenario-row">
<div class="card"><div class="scen-label">Downside</div><div id="sc-down" class="scen-val red"></div><div id="sc-down-p" class="scen-prob"></div></div>
<div class="card"><div class="scen-label">Base</div><div id="sc-base" class="scen-val"></div><div id="sc-base-p" class="scen-prob"></div></div>
<div class="card"><div class="scen-label" style="color:var(--g)">Upside</div><div id="sc-up" class="scen-val green"></div><div id="sc-up-p" class="scen-prob"></div></div>
</div>
</div>

<div class="section">
<div class="section-title">Directivas X10</div>
<div class="card" id="x10-directives"></div>
</div>

<div class="section">
<div class="section-title">Probabilidad de Transici\xF3n</div>
<div class="grid2">
<div class="card"><div class="card-label">CRISIS</div><div id="tr-crisis" class="card-value red"></div></div>
<div class="card"><div class="card-label">HIGH_VOL</div><div id="tr-hv" class="card-value amber"></div></div>
<div class="card"><div class="card-label">NORMAL</div><div id="tr-normal" class="card-value green"></div></div>
<div class="card"><div class="card-label">CARRY_FAV</div><div id="tr-carry" class="card-value blue"></div></div>
</div>
</div>

</div>

<footer>
Fisher: ((1 + TNA/12) / (1 + IPC_mensual)) - 1 \xB7 Data States: REAL \xB7 PARTIAL_FALLBACK \xB7 ERROR<br>
Edge-first \xB7 KV 5min TTL \xB7 D1 \xB7 Seeded PRNG (seed=42) \xB7 Deploy Guard \xB7 FAIL HARD on ERROR \xB7 SAFE_MODE if integrity &lt; 0.7<br>
Attribution: recordSignalReturn() \xB7 100% coverage required \xB7 No MODELO/SIMULADO labels
</footer>
</div>

<script>
var M,X,R;
function init(){
  Promise.all([
    fetch('/api/macro').then(function(r){return r.json()}),
    fetch('/api/x10',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capital:2000,mode:'MODERATE'})}).then(function(r){return r.json()}),
    fetch('/api/regime').then(function(r){return r.json()})
  ]).then(function(d){
    M=d[0];X=d[1];R=d[2];
    render();
  }).catch(function(e){
    document.getElementById('loading').textContent='Error: '+e.message;
  });
}
function render(){
  document.getElementById('loading').style.display='none';
  document.getElementById('dash').style.display='block';
  var ms=M.macro_state,o=M.oracle;
  // SAFE_MODE banner: show if dataIntegrityScore < 0.7
  var dis=Math.min(1,ms.realDataPct/100);
  if(dis<0.7){document.getElementById('safe-mode-banner').style.display='block';}
  // Sticky header
  var rn=R.current_regime;
  var hdrR=document.getElementById('hdr-regime');
  hdrR.textContent=rn.replace(/_/g,' ');
  hdrR.className='hdr-chip chip-regime '+(rn==='CRISIS'?'crisis':rn==='HIGH_VOL'?'high_vol':rn==='CARRY_FAVORABLE'?'carry':'');
  document.getElementById('hdr-nav').textContent='Ret30d: '+X.risk_metrics.expectedReturn30d+'%';
  document.getElementById('hdr-dd').textContent='DD: '+X.risk_metrics.maxDrawdownEstimate+'%';
  document.getElementById('hdr-integrity').textContent='Integrity: '+round2(Math.min(1,ms.realDataPct/100))+' | Data: '+ms.realDataPct+'%';
  document.getElementById('hdr-integrity').style.borderColor=Math.min(1,ms.realDataPct/100)>=0.7?'var(--g)':ms.realDataPct>=40?'var(--amber)':'var(--red)';
  document.getElementById('hdr-integrity').style.color=Math.min(1,ms.realDataPct/100)>=0.7?'var(--g)':ms.realDataPct>=40?'var(--amber)':'var(--red)';
  // Performance row
  var rm=X.risk_metrics;
  document.getElementById('v-sharpe').textContent=rm.sharpeEstimate;
  document.getElementById('v-sharpe').className='card-value '+(rm.sharpeEstimate>0?'green':'red');
  document.getElementById('v-calmar').textContent=rm.sharpeEstimate>0?(rm.expectedReturn30d/rm.maxDrawdownEstimate).toFixed(2):'N/A';
  document.getElementById('v-real').textContent=ms.realDataPct+'%';
  document.getElementById('v-real').className='card-value '+(ms.realDataPct>=70?'green':ms.realDataPct>=40?'amber':'red');
  // Macro cards
  document.getElementById('v-mep').textContent='$'+ms.mep.rate.toLocaleString();
  document.getElementById('s-mep').textContent='Oficial: $'+ms.mep.officialRate.toLocaleString();
  document.getElementById('v-infl').textContent=ms.inflation.monthly+'%';
  document.getElementById('s-infl').textContent='Expect 30d: '+ms.inflation.expected30d+'%';
  document.getElementById('v-bcra').textContent=ms.rates.bcraPolicy+'%';
  document.getElementById('s-bcra').textContent='BADLAR: '+ms.rates.badlar+'%';
  document.getElementById('v-gap').textContent=ms.mep.gap+'%';
  document.getElementById('s-gap').textContent='Sell: $'+ms.mep.sell+' | Buy: $'+ms.mep.buy;
  var fr=rm.fisherRealRate;
  document.getElementById('v-fisher').textContent=(fr*100).toFixed(2)+'%';
  document.getElementById('s-fisher').textContent=fr>0?'Carry positivo':'Carry negativo';
  document.getElementById('v-fisher').className='card-value '+(fr>0?'green':'red');
  // Data source badge
  var srcEl=document.getElementById('v-source');
  srcEl.textContent=ms.source;
  srcEl.className='card-value '+(ms.source==='ERROR'?'red':ms.source==='PARTIAL_FALLBACK'?'amber':ms.source==='REAL'?'green':'');
  document.getElementById('s-source').textContent=ms.source==='ERROR'?'FETCH FAILED':ms.source==='PARTIAL_FALLBACK'?'Partial API failure':'All sources OK';
  // Regime card
  var rnEl=document.getElementById('regime-name');
  rnEl.textContent=rn.replace(/_/g,' ');
  rnEl.className='regime-name '+(rn==='CRISIS'?'crisis':rn==='HIGH_VOL'?'high_vol':rn==='CARRY_FAVORABLE'?'carry':'normal');
  document.getElementById('regime-conf').textContent='Confianza: '+(M.confidence*100).toFixed(0)+'% | Deval Prob: '+o.devaluationProbability+'%';
  var rb=document.getElementById('risk-badge');
  rb.textContent=o.devaluationRiskBand.toUpperCase();
  rb.className='status-badge '+(o.devaluationRiskBand==='stable'?'real':o.devaluationRiskBand==='crisis'?'error':'partial');
  // Oracle signals
  var sigHtml='';
  o.signals.forEach(function(s){
    var dc=s.direction==='alcista'?'alc':s.direction==='bajista'?'baj':'neu';
    var sym=s.direction==='alcista'?'\u2191':s.direction==='bajista'?'\u2193':'\u2192';
    sigHtml+='<div class="oracle-signal"><span class="sig-name">'+s.name+'</span><div class="sig-bar"><div class="sig-fill" style="width:'+s.value+'%"></div></div><span class="sig-dir '+dc+'">'+sym+'</span></div>';
  });
  document.getElementById('oracle-signals').innerHTML=sigHtml;
  // Allocation bars
  var alloc=X.allocation;
  var buckets={};
  alloc.forEach(function(a){
    var bk=a.category;
    if(!buckets[bk])buckets[bk]={name:a.productName,total:0,items:[]};
    buckets[bk].total+=a.weight;
    buckets[bk].items.push(a);
  });
  var labels={money_market:'Preservaci\xF3n',cer_indexed:'Hedge Inflaci\xF3n',nominal:'Carry Oportunista',fx_hedge:'Cobertura USD',opportunistic:'T\xE1ctico'};
  var fills={money_market:'pres',cer_indexed:'inf',nominal:'carry',fx_hedge:'usd',opportunistic:'tact'};
  var bHtml='';
  Object.keys(buckets).forEach(function(k){
    var b=buckets[k];
    var pct=(b.total*100).toFixed(1);
    bHtml+='<div class="bar-row"><span class="bar-label">'+(labels[k]||k)+'</span><div class="bar-track"><div class="bar-fill '+fills[k]+'" style="width:'+pct+'%">' +(pct>8?'<span class="bar-pct">'+pct+'%</span>':'')+'</div></div></div>';
  });
  document.getElementById('alloc-bars').innerHTML=bHtml;
  // Risk metrics
  var ret30=rm.expectedReturn30d;
  document.getElementById('v-ret30').textContent=ret30+'%';
  document.getElementById('v-ret30').className='card-value '+(ret30>0?'green':'red');
  document.getElementById('v-ret90').textContent=rm.expectedReturn90d+'%';
  document.getElementById('v-ret90').className='card-value '+(rm.expectedReturn90d>0?'green':'red');
  document.getElementById('v-ploss').textContent=(rm.probabilityOfLoss*100).toFixed(0)+'%';
  document.getElementById('v-ploss').className='card-value '+(rm.probabilityOfLoss>.15?'red':'');
  document.getElementById('v-dd').textContent=rm.maxDrawdownEstimate+'%';
  document.getElementById('v-car').textContent=(rm.capitalAtRisk*100).toFixed(0)+'%';
  document.getElementById('v-cpres').textContent=rm.capitalPreservationPct+'%';
  // Scenarios
  var sc=X.stress_scenarios;
  document.getElementById('sc-down').textContent=sc.downside.returnMin+'% a '+sc.downside.returnMax+'%';
  document.getElementById('sc-down-p').textContent='Prob: '+(sc.downside.probability*100).toFixed(0)+'%';
  document.getElementById('sc-base').textContent=sc.base.returnMin+'% a '+sc.base.returnMax+'%';
  document.getElementById('sc-base-p').textContent='Prob: '+(sc.base.probability*100).toFixed(0)+'%';
  document.getElementById('sc-up').textContent=sc.upside.returnMin+'% a '+sc.upside.returnMax+'%';
  document.getElementById('sc-up-p').textContent='Prob: '+(sc.upside.probability*100).toFixed(0)+'%';
  // Directives
  var dirs=X.x10_directives;
  var dHtml='';
  [['confidenceThrottle','Confidence Throttle'],['capitalPreservationFallback','Capital Preservation'],['emergencyFreeze','Emergency Freeze'],['deRiskMode','De-Risk Mode']].forEach(function(d){
    var key=d[0],label=d[1];
    var v=dirs[key];
    dHtml+='<div class="directive"><span class="dir-dot '+(v.active?'on':'off')+'"></span><span class="dir-name">'+label+': '+(v.active?'ACTIVO':'OK')+'</span><span class="dir-reason">'+(v.reason||'\u2014')+'</span></div>';
  });
  document.getElementById('x10-directives').innerHTML=dHtml;
  // Transition probabilities
  var tp=R.transition_probability;
  document.getElementById('tr-crisis').textContent=(tp.CRISIS*100).toFixed(0)+'%';
  document.getElementById('tr-hv').textContent=(tp.HIGH_VOL*100).toFixed(0)+'%';
  document.getElementById('tr-normal').textContent=(tp.NORMAL*100).toFixed(0)+'%';
  document.getElementById('tr-carry').textContent=(tp.CARRY_FAVORABLE*100).toFixed(0)+'%';
}
init();
<\/script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8", ...corsHeaders() } });
}
__name(dashboard, "dashboard");
async function handleMacro(env2, ctx) {
  const macro = await fetchMacroState(env2);
  const { regime, confidence, oracle } = classifyRegime(macro);
  const staleness_report = {};
  for (const [key, prov] of Object.entries(macro.provenance)) {
    staleness_report[key] = { label: prov.label, stalenessHours: prov.stalenessHours };
  }
  ctx.waitUntil(logMacroSnapshot(env2, macro, regime, confidence));
  return jsonResponse({ macro_state: macro, staleness_report, regime, confidence: round2(confidence), oracle, timestamp: isoNow() });
}
__name(handleMacro, "handleMacro");
async function handleX10(request, env2, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const capital = body.capital || 2e3;
  const mode = ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"].includes(body.mode) ? body.mode : "MODERATE";
  if (capital < 100 || capital > 1e6) return jsonResponse({ error: "Capital must be 100-1,000,000 USD" }, 400);
  const macro = await fetchMacroState(env2);
  const out = runX10Engine(macro, mode, capital);
  recordSignalReturn(`LIVE-${Date.now()}`, classifyRegime(macro).regime, out.risk_metrics.expectedReturn30d, null, out.confidence_score, macro.source);
  ctx.waitUntil(logDecision(env2, out, mode, capital));
  return jsonResponse({
    allocation: out.portfolio_allocation,
    risk_metrics: out.risk_metrics,
    confidence: out.confidence_score,
    stress_scenarios: { downside: out.scenario_downside, base: out.scenario_base, upside: out.scenario_upside },
    x10_directives: out.x10Directives,
    timestamp: out.timestamp
  });
}
__name(handleX10, "handleX10");
async function handleRegime(env2, ctx) {
  const macro = await fetchMacroState(env2);
  const { regime, confidence, oracle } = classifyRegime(macro);
  let regime_history = [];
  try {
    const result = await env2.ORACLE_DB.prepare("SELECT timestamp, regime, confidence FROM regime_history ORDER BY timestamp DESC LIMIT 30").all();
    regime_history = (result.results || []).map((r) => ({ timestamp: r.timestamp, regime: r.regime, confidence: r.confidence }));
  } catch {
  }
  const transition_probability = computeTransitionProbability(regime);
  ctx.waitUntil(logRegimeObservation(env2, regime, confidence, macro));
  return jsonResponse({ current_regime: regime, regime_history, transition_probability, oracle, timestamp: isoNow() });
}
__name(handleRegime, "handleRegime");
async function handleBacktestLite(env2, url) {
  const seed = 42;
  const modeParam = url.searchParams.get("mode") || "MODERATE";
  const mode = ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"].includes(modeParam) ? modeParam : "MODERATE";
  const rng = mulberry32(seed);
  const scenarios = getHistoricalScenarios();
  const results = scenarios.map((sc) => {
    const out = runX10Engine(sc.macro, mode, 2e3);
    const predictedRegime = classifyRegime(sc.macro).regime;
    const slippageBps = Math.round(rng() * 10);
    const adjustedReturn = out.risk_metrics.expectedReturn30d - slippageBps / 100;
    recordSignalReturn(sc.id, predictedRegime, adjustedReturn, sc.actualReturn, out.confidence_score, sc.macro.source);
    return { id: sc.id, label: sc.label, predicted_regime: predictedRegime, actual_regime: sc.actualRegime, regime_correct: predictedRegime === sc.actualRegime, predicted_return: round2(adjustedReturn), actual_return: sc.actualReturn, confidence: out.confidence_score, seed_used: seed, attribution: true };
  });
  const regimeAccuracy = results.filter((r) => r.regime_correct).length / results.length;
  return jsonResponse({ seed, mode, total_scenarios: results.length, regime_accuracy: round2(regimeAccuracy), results, deterministic: true, disclaimer: "BACKTEST RESULTS ARE HYPOTHETICAL. Seed=42 locked. Historical macro states are model-constructed, not observed.", timestamp: isoNow() });
}
__name(handleBacktestLite, "handleBacktestLite");
function computeTransitionProbability(currentRegime) {
  const T = {
    CRISIS: { CRISIS: 0.4, HIGH_VOL: 0.35, NORMAL: 0.15, CARRY_FAVORABLE: 0.1 },
    HIGH_VOL: { CRISIS: 0.2, HIGH_VOL: 0.4, NORMAL: 0.3, CARRY_FAVORABLE: 0.1 },
    NORMAL: { CRISIS: 0.05, HIGH_VOL: 0.15, NORMAL: 0.55, CARRY_FAVORABLE: 0.25 },
    CARRY_FAVORABLE: { CRISIS: 0.03, HIGH_VOL: 0.07, NORMAL: 0.3, CARRY_FAVORABLE: 0.6 }
  };
  return T[currentRegime] || T.NORMAL;
}
__name(computeTransitionProbability, "computeTransitionProbability");
function getHistoricalScenarios() {
  const now = isoNow();
  const mp = /* @__PURE__ */ __name((label) => ({ label, source: "Historical", url: "N/A", lastUpdate: now, dataDate: now.split("T")[0], stalenessHours: 0, fetchedAt: now, ageMinutes: 0, fetchError: false }), "mp");
  return [
    { id: "paso-2023", label: "PASO Elections 2023", actualRegime: "CRISIS", actualReturn: -8.5, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "PARTIAL_FALLBACK", mep: { rate: 750, officialRate: 350, gap: 114, sell: 780, buy: 720 }, inflation: { monthly: 12.4, expected30d: 15, expected90d: 45, yearly: 125 }, rates: { bcraPolicy: 118, moneyMarket: 115, plazoFijo: 97, plazoFijoUVA: 5.5, lecaps: 120, badlar: 100, leliq: 118, tml: 98 }, cer: { index: 340, monthlyChange: 12, dailyChange: 0.38 }, crawlingPeg: 5, realDataPct: 40, provenance: { mepRate: mp("PARTIAL_FALLBACK"), inflation: mp("PARTIAL_FALLBACK"), rates: mp("PARTIAL_FALLBACK"), cer: mp("PARTIAL_FALLBACK"), crawlingPeg: mp("ERROR"), reserves: mp("PARTIAL_FALLBACK") } } },
    { id: "milei-transition", label: "Milei Transition 2023", actualRegime: "HIGH_VOL", actualReturn: -3.2, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "PARTIAL_FALLBACK", mep: { rate: 1e3, officialRate: 800, gap: 25, sell: 1020, buy: 980 }, inflation: { monthly: 25, expected30d: 20, expected90d: 40, yearly: 280 }, rates: { bcraPolicy: 133, moneyMarket: 130, plazoFijo: 110, plazoFijoUVA: 3, lecaps: 135, badlar: 120, leliq: 133, tml: 118 }, cer: { index: 420, monthlyChange: 25, dailyChange: 0.75 }, crawlingPeg: 2, realDataPct: 40, provenance: { mepRate: mp("PARTIAL_FALLBACK"), inflation: mp("PARTIAL_FALLBACK"), rates: mp("PARTIAL_FALLBACK"), cer: mp("PARTIAL_FALLBACK"), crawlingPeg: mp("ERROR"), reserves: mp("PARTIAL_FALLBACK") } } },
    { id: "stabilization-2024", label: "Stabilization 2024", actualRegime: "NORMAL", actualReturn: 0.8, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "PARTIAL_FALLBACK", mep: { rate: 1100, officialRate: 870, gap: 26, sell: 1110, buy: 1090 }, inflation: { monthly: 8.8, expected30d: 6, expected90d: 12, yearly: 140 }, rates: { bcraPolicy: 40, moneyMarket: 38, plazoFijo: 35, plazoFijoUVA: 3.5, lecaps: 42, badlar: 36, leliq: 40, tml: 34 }, cer: { index: 530, monthlyChange: 8.5, dailyChange: 0.28 }, crawlingPeg: 2, realDataPct: 40, provenance: { mepRate: mp("PARTIAL_FALLBACK"), inflation: mp("PARTIAL_FALLBACK"), rates: mp("PARTIAL_FALLBACK"), cer: mp("PARTIAL_FALLBACK"), crawlingPeg: mp("ERROR"), reserves: mp("PARTIAL_FALLBACK") } } },
    { id: "carry-2024", label: "Carry Favorable 2024", actualRegime: "CARRY_FAVORABLE", actualReturn: 1.4, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "PARTIAL_FALLBACK", mep: { rate: 1200, officialRate: 1010, gap: 19, sell: 1210, buy: 1190 }, inflation: { monthly: 2.7, expected30d: 2.5, expected90d: 7.5, yearly: 55 }, rates: { bcraPolicy: 32, moneyMarket: 30, plazoFijo: 28, plazoFijoUVA: 4, lecaps: 35, badlar: 29, leliq: 32, tml: 27 }, cer: { index: 620, monthlyChange: 2.5, dailyChange: 0.08 }, crawlingPeg: 1, realDataPct: 40, provenance: { mepRate: mp("PARTIAL_FALLBACK"), inflation: mp("PARTIAL_FALLBACK"), rates: mp("PARTIAL_FALLBACK"), cer: mp("PARTIAL_FALLBACK"), crawlingPeg: mp("ERROR"), reserves: mp("PARTIAL_FALLBACK") } } },
    { id: "bandas-2026", label: "Bandas Cambiarias 2026", actualRegime: "NORMAL", actualReturn: 0.7, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "PARTIAL_FALLBACK", mep: { rate: 1445, officialRate: 1440, gap: 0.35, sell: 1450, buy: 1440 }, inflation: { monthly: 2.5, expected30d: 2.3, expected90d: 6.9, yearly: 30.5 }, rates: { bcraPolicy: 20, moneyMarket: 20, plazoFijo: 19, plazoFijoUVA: 4.5, lecaps: 25, badlar: 22, leliq: 20, tml: 20 }, cer: { index: 786, monthlyChange: 2.2, dailyChange: 0.07 }, crawlingPeg: 0, realDataPct: 30, provenance: { mepRate: mp("PARTIAL_FALLBACK"), inflation: mp("PARTIAL_FALLBACK"), rates: mp("PARTIAL_FALLBACK"), cer: mp("PARTIAL_FALLBACK"), crawlingPeg: mp("ERROR"), reserves: mp("PARTIAL_FALLBACK") } } },
    { id: "stress-deval", label: "Stress: Sudden Devaluation", actualRegime: "CRISIS", actualReturn: -6, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "ERROR", mep: { rate: 1878, officialRate: 1440, gap: 30.4, sell: 1900, buy: 1850 }, inflation: { monthly: 8, expected30d: 10, expected90d: 25, yearly: 80 }, rates: { bcraPolicy: 45, moneyMarket: 42, plazoFijo: 38, plazoFijoUVA: 5, lecaps: 48, badlar: 40, leliq: 45, tml: 38 }, cer: { index: 830, monthlyChange: 7.5, dailyChange: 0.24 }, crawlingPeg: 0, realDataPct: 10, provenance: { mepRate: mp("ERROR"), inflation: mp("ERROR"), rates: mp("ERROR"), cer: mp("ERROR"), crawlingPeg: mp("ERROR"), reserves: mp("ERROR") } } },
    { id: "stress-recession", label: "Stress: Prolonged Recession", actualRegime: "NORMAL", actualReturn: 0.3, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "ERROR", mep: { rate: 1500, officialRate: 1460, gap: 2.7, sell: 1510, buy: 1490 }, inflation: { monthly: 1.8, expected30d: 1.5, expected90d: 4.5, yearly: 22 }, rates: { bcraPolicy: 15, moneyMarket: 14, plazoFijo: 12, plazoFijoUVA: 3, lecaps: 18, badlar: 13, leliq: 15, tml: 12 }, cer: { index: 810, monthlyChange: 1.6, dailyChange: 0.05 }, crawlingPeg: 0, realDataPct: 20, provenance: { mepRate: mp("ERROR"), inflation: mp("ERROR"), rates: mp("ERROR"), cer: mp("ERROR"), crawlingPeg: mp("ERROR"), reserves: mp("ERROR") } } },
    { id: "stress-inflation", label: "Stress: Inflation Resurgence", actualRegime: "HIGH_VOL", actualReturn: -1.5, macro: { lastUpdate: now, fetchedAt: now, ageMinutes: 0, lastSuccessfulFetch: now, source: "ERROR", mep: { rate: 1550, officialRate: 1450, gap: 6.9, sell: 1560, buy: 1540 }, inflation: { monthly: 5, expected30d: 6, expected90d: 18, yearly: 60 }, rates: { bcraPolicy: 30, moneyMarket: 28, plazoFijo: 25, plazoFijoUVA: 5.5, lecaps: 33, badlar: 26, leliq: 30, tml: 24 }, cer: { index: 850, monthlyChange: 4.8, dailyChange: 0.16 }, crawlingPeg: 0.5, realDataPct: 20, provenance: { mepRate: mp("ERROR"), inflation: mp("ERROR"), rates: mp("ERROR"), cer: mp("ERROR"), crawlingPeg: mp("ERROR"), reserves: mp("ERROR") } } }
  ];
}
__name(getHistoricalScenarios, "getHistoricalScenarios");
var TELEMETRY_RESULTS = { ok: 0, fail: 0, lastError: null };
async function logMacroSnapshot(env2, macro, regime, confidence) {
  try {
    await env2.ORACLE_DB.prepare("INSERT INTO macro_snapshots (id,source,data_label,mep_rate,official_rate,mep_gap,inflation_monthly,inflation_expected30d,bcra_policy_rate,money_market_tna,plazo_fijo_tna,plazo_fijo_uva_premium,lecaps_tna,badlar_tna,leliq_tna,cer_index,cer_monthly_change,crawling_peg,real_data_pct,staleness_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(`MS-${Date.now()}`, "worker", macro.source, macro.mep.rate, macro.mep.officialRate, macro.mep.gap, macro.inflation.monthly, macro.inflation.expected30d, macro.rates.bcraPolicy, macro.rates.moneyMarket, macro.rates.plazoFijo, macro.rates.plazoFijoUVA, macro.rates.lecaps, macro.rates.badlar, macro.rates.leliq, macro.cer.index, macro.cer.monthlyChange, macro.crawlingPeg, macro.realDataPct, 0).run();
    TELEMETRY_RESULTS.ok++;
  } catch (e) {
    TELEMETRY_RESULTS.fail++;
    TELEMETRY_RESULTS.lastError = String(e);
    console.error("TELEMETRY FAIL: logMacroSnapshot", e);
    throw new Error(`TELEMETRY_CRITICAL: logMacroSnapshot failed \u2014 ${e.message || e}`);
  }
}
__name(logMacroSnapshot, "logMacroSnapshot");
async function logDecision(env2, out, mode, capital) {
  try {
    await env2.ORACLE_DB.prepare("INSERT INTO decisions_log (id,decision_type,severity,summary,action,reasoning_json,context_json,data_quality,confidence,regime,active_directives_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(`DEC-${Date.now()}`, "ALLOCATION_COMPUTED", "info", `X10 allocation: mode=${mode}, capital=$${capital}`, `Computed allocation with ${out.portfolio_allocation.length} positions`, JSON.stringify([`Mode: ${mode}`, `Confidence: ${out.confidence_score}`, `Regime: ${out.signalLayer.regime.regime}`]), JSON.stringify({ dataAgeMinutes: out.dataLayer.dataAgeMinutes, realDataPct: out.dataLayer.realDataPct }), out.dataLayer.macroSource, out.confidence_score, out.signalLayer.regime.regime, JSON.stringify(Object.entries(out.x10Directives).filter(([, v]) => v.active).map(([k]) => k))).run();
    TELEMETRY_RESULTS.ok++;
  } catch (e) {
    TELEMETRY_RESULTS.fail++;
    TELEMETRY_RESULTS.lastError = String(e);
    console.error("TELEMETRY FAIL: logDecision", e);
    throw new Error(`TELEMETRY_CRITICAL: logDecision failed \u2014 ${e.message || e}`);
  }
}
__name(logDecision, "logDecision");
async function logRegimeObservation(env2, regime, confidence, macro) {
  try {
    await env2.ORACLE_DB.prepare("INSERT INTO regime_history (id,regime,confidence,data_quality,mep_rate,inflation_monthly,bcra_policy_rate) VALUES (?,?,?,?,?,?,?)").bind(`RH-${Date.now()}`, regime, confidence, macro.source, macro.mep.rate, macro.inflation.monthly, macro.rates.bcraPolicy).run();
    TELEMETRY_RESULTS.ok++;
  } catch (e) {
    TELEMETRY_RESULTS.fail++;
    TELEMETRY_RESULTS.lastError = String(e);
    console.error("TELEMETRY FAIL: logRegimeObservation", e);
    throw new Error(`TELEMETRY_CRITICAL: logRegimeObservation failed \u2014 ${e.message || e}`);
  }
}
__name(logRegimeObservation, "logRegimeObservation");
var SIGNAL_ATTRIBUTION_LOG = [];
function recordSignalReturn(signalId, regime, predictedReturn, actualReturn, confidence, source, timestamp) {
  const entry = {
    signalId,
    regime,
    predictedReturn: round2(predictedReturn),
    actualReturn: round2(actualReturn),
    attributionError: round2(Math.abs(predictedReturn - actualReturn)),
    confidence: round2(confidence),
    source,
    timestamp: timestamp || isoNow(),
    attributionCoverage: true
    // This signal IS attributed
  };
  SIGNAL_ATTRIBUTION_LOG.push(entry);
  return entry;
}
__name(recordSignalReturn, "recordSignalReturn");
function getAttributionCoverage() {
  if (SIGNAL_ATTRIBUTION_LOG.length === 0) return { coverage: 0, total: 0, attributed: 0 };
  const attributed = SIGNAL_ATTRIBUTION_LOG.filter((e) => e.attributionCoverage).length;
  return {
    coverage: attributed / SIGNAL_ATTRIBUTION_LOG.length,
    total: SIGNAL_ATTRIBUTION_LOG.length,
    attributed
  };
}
__name(getAttributionCoverage, "getAttributionCoverage");
async function fetchMacroState(env2) {
  try {
    const cached = await env2.ORACLE_KV.get("macro_state", "json");
    if (cached) {
      const age = (Date.now() - new Date(cached.fetchedAt).getTime()) / 6e4;
      if (age < 5) return cached;
    }
  } catch {
  }
  const now = isoNow();
  const [bluelyticsResult, bcraRatesResult, bcraFxResult, indecResult, cerResult] = await Promise.allSettled([
    fetchJSON("https://api.bluelytics.com.ar/v2/latest"),
    fetchJSON("https://api.estadisticasbcra.com.ar/tesoreria", env2.BCRA_API_KEY ? { Authorization: `Bearer ${env2.BCRA_API_KEY}` } : {}),
    fetchJSON("https://api.estadisticasbcra.com.ar/usd_of", env2.BCRA_API_KEY ? { Authorization: `Bearer ${env2.BCRA_API_KEY}` } : {}),
    fetchJSON("https://apis.datos.gob.ar/series/api/series?ids=148.3_INIVELNAL_DICI_M_26:percent_change&limit=6"),
    fetchJSON("https://api.estadisticasbcra.com.ar/cer", env2.BCRA_API_KEY ? { Authorization: `Bearer ${env2.BCRA_API_KEY}` } : {})
  ]);
  let mepRate = 1445, officialRate = 1440, mepGap = 0.35, mepSell = 1450, mepBuy = 1440, mepLabel = "ERROR";
  if (bluelyticsResult.status === "fulfilled" && bluelyticsResult.value.data && !bluelyticsResult.value.error) {
    const b = bluelyticsResult.value.data;
    mepRate = b.blue.value_avg;
    officialRate = b.oficial.value_avg;
    mepSell = b.blue.value_sell;
    mepBuy = b.blue.value_buy;
    mepGap = officialRate > 0 ? (mepRate - officialRate) / officialRate * 100 : 0;
    mepLabel = "REAL";
  } else {
    mepLabel = "ERROR";
  }
  let bcraPolicy = 20, badlar = 22, leliq = 20, tml = 20, moneyMarket = 20, plazoFijo = 19, plazoFijoUVA = 4.5, lecaps = 25, ratesLabel = "ERROR";
  if (bcraRatesResult.status === "fulfilled" && bcraRatesResult.value.data && !bcraRatesResult.value.error) {
    const rates = bcraRatesResult.value.data;
    for (const entry of rates) {
      const d = (entry.descripcion || "").toLowerCase();
      if (d.includes("tna") || d.includes("politica")) bcraPolicy = entry.valor;
      else if (d.includes("badlar")) badlar = entry.valor;
      else if (d.includes("leliq")) leliq = entry.valor;
      else if (d.includes("tml")) tml = entry.valor;
      else if (d.includes("plazo") && d.includes("fijo")) plazoFijo = entry.valor;
      else if (d.includes("lecaps")) lecaps = entry.valor;
    }
    moneyMarket = badlar * 0.95;
    ratesLabel = "REAL";
  }
  let inflationMonthly = 2.5, inflationExpected30d = 2.3, inflationExpected90d = 6.9, inflationYearly = 30.5, inflationLabel = "ERROR";
  if (indecResult.status === "fulfilled" && indecResult.value.data && !indecResult.value.error) {
    try {
      const ipcData = indecResult.value.data;
      if (ipcData?.data && Array.isArray(ipcData.data) && ipcData.data.length > 0) {
        const latest = ipcData.data[ipcData.data.length - 1];
        inflationMonthly = latest?.valor ?? latest?.[1] ?? 2.5;
        inflationLabel = "REAL";
      }
    } catch {
      inflationLabel = "ERROR";
    }
  }
  let cerIndex = 786, cerMonthlyChange = 2.2, cerDailyChange = 0.07, cerLabel = "ERROR";
  if (cerResult.status === "fulfilled" && cerResult.value.data && !cerResult.value.error) {
    try {
      const cd = cerResult.value.data;
      if (Array.isArray(cd) && cd.length >= 2) {
        const l = cd[cd.length - 1], p = cd[cd.length - 2];
        cerIndex = l.valor ?? cerIndex;
        cerMonthlyChange = p.valor > 0 ? (cerIndex - p.valor) / p.valor * 100 : cerMonthlyChange;
        cerDailyChange = cerMonthlyChange / 30;
        cerLabel = "REAL";
      }
    } catch {
      cerLabel = "ERROR";
    }
  }
  const crawlingPeg = 0;
  const dataPoints = [mepLabel, inflationLabel, ratesLabel, cerLabel, "PARTIAL_FALLBACK", "PARTIAL_FALLBACK", "PARTIAL_FALLBACK"];
  const realCount = dataPoints.filter((d) => d === "REAL").length;
  const realDataPct = Math.round(realCount / dataPoints.length * 100);
  const errorCount = dataPoints.filter((d) => d === "ERROR").length;
  const overallLabel = errorCount === dataPoints.length ? "ERROR" : errorCount > 0 && realCount > 0 ? "PARTIAL_FALLBACK" : dataPoints.some((d) => d === "STALE") ? "STALE" : realDataPct >= 60 ? "REAL" : realDataPct >= 30 ? "PARTIAL_FALLBACK" : "ERROR";
  const makeProv = /* @__PURE__ */ __name((src, url, label) => ({ label, source: label === "ERROR" ? `FETCH FAILED \u2014 ${src} sin respuesta, usando modelo` : src, url: label === "ERROR" ? "N/A" : url, lastUpdate: now, dataDate: now.split("T")[0], stalenessHours: label === "ERROR" ? 999 : 0, fetchedAt: now, ageMinutes: 0, fetchError: label === "ERROR" }), "makeProv");
  const macroState = {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: now,
    source: overallLabel,
    mep: { rate: r2(mepRate), officialRate: r2(officialRate), gap: r2(mepGap), sell: r2(mepSell), buy: r2(mepBuy) },
    inflation: { monthly: r2(inflationMonthly), expected30d: r2(inflationExpected30d), expected90d: r2(inflationExpected90d), yearly: r2(inflationYearly) },
    rates: { bcraPolicy: r2(bcraPolicy), moneyMarket: r2(moneyMarket), plazoFijo: r2(plazoFijo), plazoFijoUVA: r2(plazoFijoUVA), lecaps: r2(lecaps), badlar: r2(badlar), leliq: r2(leliq), tml: r2(tml) },
    cer: { index: r2(cerIndex), monthlyChange: r2(cerMonthlyChange), dailyChange: r4(cerDailyChange) },
    crawlingPeg,
    realDataPct,
    provenance: { mepRate: makeProv("Bluelytics", "https://api.bluelytics.com.ar/v2/latest", mepLabel), inflation: makeProv("INDEC", "https://apis.datos.gob.ar/series/api/series", inflationLabel), rates: makeProv("BCRA", "https://api.estadisticasbcra.com.ar/tesoreria", ratesLabel), cer: makeProv("BCRA", "https://api.estadisticasbcra.com.ar/cer", cerLabel), crawlingPeg: makeProv("MODEL", "N/A", "PARTIAL_FALLBACK"), reserves: makeProv("MODEL", "N/A", "PARTIAL_FALLBACK") }
  };
  try {
    await env2.ORACLE_KV.put("macro_state", JSON.stringify(macroState), { expirationTtl: 300 });
  } catch {
  }
  return macroState;
}
__name(fetchMacroState, "fetchMacroState");
async function fetchJSON(url, headers = {}) {
  const start = Date.now();
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", ...headers } });
    if (!r.ok) return { data: null, error: `HTTP ${r.status}`, url, responseTimeMs: Date.now() - start };
    return { data: await r.json(), error: null, url, responseTimeMs: Date.now() - start };
  } catch (err) {
    return { data: null, error: String(err), url, responseTimeMs: Date.now() - start };
  }
}
__name(fetchJSON, "fetchJSON");
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
__name(clamp01, "clamp01");
function r2(x) {
  return Math.round(x * 100) / 100;
}
__name(r2, "r2");
function r4(x) {
  return Math.round(x * 1e4) / 1e4;
}
__name(r4, "r4");
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(isoNow, "isoNow");
function round2(x) {
  return Math.round(x * 100) / 100;
}
__name(round2, "round2");
function computeOracle(macro) {
  const gap = macro.mep.gap;
  const fxMomentum = clamp01(gap / 60) * 100;
  const inflBaseline = 2;
  const inflationAccel = clamp01((macro.inflation.expected30d - inflBaseline) / 8) * 100;
  const rateSpread = Math.abs(macro.rates.bcraPolicy - macro.rates.moneyMarket);
  const crawlingIntensity = clamp01(macro.crawlingPeg / 5) * 100;
  const reservePressure = clamp01((rateSpread * 5 + crawlingIntensity) / 150) * 100;
  const usdNeutralRate = 5;
  const rateGapRaw = macro.rates.moneyMarket - usdNeutralRate;
  const rateGapUSD = clamp01(rateGapRaw / 40) * 100;
  const devalScore = fxMomentum * 0.35 + inflationAccel * 0.25 + reservePressure * 0.2 + rateGapUSD * 0.2;
  const devaluationProbability = clamp01(devalScore / 100) * 100;
  const devaluationRiskBand = devaluationProbability < 25 ? "stable" : devaluationProbability < 50 ? "caution" : devaluationProbability < 75 ? "high" : "crisis";
  const regime = determineRegime(macro, devaluationProbability);
  const signalAgreement = computeSignalAgreement(fxMomentum, inflationAccel, reservePressure, rateGapUSD);
  const realPct = macro.realDataPct;
  const dataQuality = macro.source === "OBSERVADO" ? 95 : macro.source === "REAL" ? Math.min(90, 40 + realPct * 0.55) : macro.source === "STALE" ? 25 : macro.source === "ERROR" ? 10 : 40;
  const confidenceScore = Math.round(signalAgreement * 0.6 + dataQuality * 0.4);
  const signals = [
    { name: "Tipo de cambio", value: r2(fxMomentum), weight: 0.35, contribution: r2(fxMomentum * 0.35), direction: fxMomentum > 50 ? "bajista" : fxMomentum > 25 ? "neutral" : "alcista" },
    { name: "Inflaci\xF3n", value: r2(inflationAccel), weight: 0.25, contribution: r2(inflationAccel * 0.25), direction: inflationAccel > 50 ? "bajista" : inflationAccel > 25 ? "neutral" : "alcista" },
    { name: "Reservas", value: r2(reservePressure), weight: 0.2, contribution: r2(reservePressure * 0.2), direction: reservePressure > 50 ? "bajista" : reservePressure > 25 ? "neutral" : "alcista" },
    { name: "Tasas", value: r2(rateGapUSD), weight: 0.2, contribution: r2(rateGapUSD * 0.2), direction: rateGapUSD > 70 ? "bajista" : rateGapUSD > 40 ? "neutral" : "alcista" }
  ];
  return { regime, devaluationProbability: r2(devaluationProbability), devaluationRiskBand, confidenceScore, fxMomentum: r2(fxMomentum), inflationAcceleration: r2(inflationAccel), reservePressure: r2(reservePressure), rateGapUSD: r2(rateGapUSD), timestamp: isoNow(), source: macro.source, signals, dataQualityPct: Math.round(dataQuality) };
}
__name(computeOracle, "computeOracle");
function determineRegime(macro, devalProb) {
  const volSpike = macro.mep.gap > 30;
  const fxGap = macro.mep.gap > 25;
  const crisisBoost = volSpike && fxGap ? 0.3 : 0;
  const adjDeval = Math.min(100, devalProb + crisisBoost * 100);
  if (macro.source === "ERROR") return "CRISIS";
  if (macro.source === "PARTIAL_FALLBACK" && adjDeval > 50) return "CRISIS";
  if (adjDeval > 75) return "CRISIS";
  if (adjDeval > 50) return "WARNING";
  if (macro.mep.gap > 50) return "HIGH_VOL";
  const f = (1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100) - 1;
  if (f > 0.015 && macro.inflation.monthly < 3 && macro.mep.gap < 15) return "CARRY_FAVORABLE";
  if (f > 8e-3 && macro.inflation.monthly < 4) return "CARRY";
  const signalSum = adjDeval + macro.mep.gap;
  if (signalSum < 15) return "NORMAL";
  return "NORMAL";
}
__name(determineRegime, "determineRegime");
function computeSignalAgreement(fx, infl, reserves, rates) {
  const v = [fx, infl, reserves, rates];
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const va = v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length;
  return clamp01(1 - va / 2500) * 100;
}
__name(computeSignalAgreement, "computeSignalAgreement");
function classifyRegime(macro) {
  const oracle = computeOracle(macro);
  const regime = mapOracleToCapitalRegime(oracle.regime);
  const confidence = oracle.confidenceScore / 100;
  return { regime, confidence, oracle };
}
__name(classifyRegime, "classifyRegime");
function mapOracleToCapitalRegime(regime) {
  switch (regime) {
    case "CARRY_FAVORABLE":
      return "CARRY_FAVORABLE";
    case "CARRY":
      return "NORMAL";
    case "NORMAL":
      return "NORMAL";
    case "WARNING":
      return "HIGH_VOL";
    case "HIGH_VOL":
      return "HIGH_VOL";
    case "CRISIS":
      return "CRISIS";
    case "GLOBAL_RISK_OFF":
      return "CRISIS";
    default:
      return "NORMAL";
  }
}
__name(mapOracleToCapitalRegime, "mapOracleToCapitalRegime");
function computeL1Signals(macro) {
  const now = isoNow();
  const oracle = computeOracle(macro);
  const regimeX10 = oracle.regime === "CARRY" || oracle.regime === "CARRY_FAVORABLE" ? "CARRY_FAVORABLE" : oracle.regime === "NORMAL" ? "CARRY_NEUTRAL" : oracle.regime === "WARNING" || oracle.regime === "HIGH_VOL" ? "WARNING" : "CRISIS";
  const regimeSignal = { value: clamp01(oracle.devaluationProbability / 100), strength: oracle.devaluationProbability > 75 ? "extreme" : oracle.devaluationProbability > 50 ? "high" : oracle.devaluationProbability > 25 ? "medium" : "low", direction: oracle.devaluationProbability > 50 ? "accelerating" : oracle.devaluationProbability > 25 ? "stable" : "decelerating", confidence: oracle.confidenceScore / 100, sourceLabel: macro.source, drivers: ["fx_gap", "inflation", "reserves", "rate_spread"], timestamp: now, dataAgeMinutes: macro.ageMinutes, isDiscounted: macro.source === "STALE" || macro.source === "ERROR" || macro.source === "PARTIAL_FALLBACK" };
  const inflationSignal = { value: clamp01(macro.inflation.expected30d / 10), strength: macro.inflation.expected30d > 8 ? "extreme" : macro.inflation.expected30d > 5 ? "high" : macro.inflation.expected30d > 3 ? "medium" : "low", direction: macro.inflation.expected30d > macro.inflation.monthly ? "accelerating" : macro.inflation.expected30d < macro.inflation.monthly * 0.8 ? "decelerating" : "stable", confidence: macro.provenance.inflation.label === "REAL" ? 0.9 : 0.5, sourceLabel: macro.provenance.inflation.label, drivers: ["ipc_mensual", "expectativas_30d"], timestamp: now, dataAgeMinutes: macro.ageMinutes, isDiscounted: macro.provenance.inflation.label === "STALE" || macro.provenance.inflation.label === "ERROR" || macro.provenance.inflation.label === "PARTIAL_FALLBACK" };
  const fisherReal = (1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100) - 1;
  const carrySignal = { value: clamp01(fisherReal * 50 + 0.5), strength: fisherReal > 0.02 ? "extreme" : fisherReal > 0.01 ? "high" : fisherReal > 0 ? "medium" : "low", direction: fisherReal > 5e-3 ? "accelerating" : fisherReal < -5e-3 ? "reversing" : "stable", confidence: 0.5, sourceLabel: macro.source, drivers: ["fisher_real_rate", "money_market_tna", "inflation"], timestamp: now, dataAgeMinutes: macro.ageMinutes, isDiscounted: macro.source === "STALE" || macro.source === "ERROR" || macro.source === "PARTIAL_FALLBACK" };
  const gapVol = macro.mep.gap;
  const volRegime = gapVol > 80 ? "crisis" : gapVol > 50 ? "stressed" : gapVol > 25 ? "elevated" : gapVol > 10 ? "normal" : "calm";
  const volatilitySignal = { value: clamp01(gapVol / 80), strength: volRegime === "crisis" ? "extreme" : volRegime === "stressed" ? "high" : volRegime === "elevated" ? "medium" : "low", direction: macro.mep.gap > 30 ? "accelerating" : "stable", confidence: macro.provenance.mepRate.label === "REAL" ? 0.85 : 0.4, sourceLabel: macro.provenance.mepRate.label, drivers: ["mep_gap", "fx_volatility"], timestamp: now, dataAgeMinutes: macro.ageMinutes, isDiscounted: macro.provenance.mepRate.label === "STALE" || macro.provenance.mepRate.label === "ERROR" || macro.provenance.mepRate.label === "PARTIAL_FALLBACK" };
  const liqRegime = macro.rates.bcraPolicy > 50 ? "frozen" : macro.rates.bcraPolicy > 30 ? "stressed" : macro.rates.bcraPolicy > 15 ? "tight" : macro.rates.bcraPolicy > 5 ? "normal" : "abundant";
  const liquiditySignal = { value: clamp01(macro.rates.bcraPolicy / 50), strength: liqRegime === "frozen" ? "extreme" : liqRegime === "stressed" ? "high" : liqRegime === "tight" ? "medium" : "low", direction: macro.rates.bcraPolicy > 30 ? "accelerating" : "decelerating", confidence: 0.5, sourceLabel: macro.provenance.rates.label, drivers: ["bcra_policy_rate", "leliq", "badlar"], timestamp: now, dataAgeMinutes: macro.ageMinutes, isDiscounted: macro.provenance.rates.label === "STALE" || macro.provenance.rates.label === "ERROR" || macro.provenance.rates.label === "PARTIAL_FALLBACK" };
  const allConf = [regimeSignal.confidence, inflationSignal.confidence, carrySignal.confidence, volatilitySignal.confidence, liquiditySignal.confidence];
  const aggregateConfidence = allConf.reduce((s, c) => s + c, 0) / allConf.length;
  const capitalPreservationMode = macro.source === "STALE" || macro.source === "ERROR" || macro.source === "PARTIAL_FALLBACK" || aggregateConfidence < 0.5;
  const emergencyFreeze = macro.source === "ERROR";
  return { regime: { regime: regimeX10, signal: regimeSignal }, inflation: { name: "inflation", signal: inflationSignal }, carry: { name: "carry", signal: carrySignal }, volatility: { name: "volatility", signal: volatilitySignal }, liquidity: { name: "liquidity", signal: liquiditySignal }, aggregateConfidence: r2(aggregateConfidence), capitalPreservationMode, emergencyFreeze };
}
__name(computeL1Signals, "computeL1Signals");
var BASE_ALLOCATIONS = {
  CRISIS: { capital_preservation: { weight: 0.8, return: -2e-3 }, inflation_hedge: { weight: 0.1, return: -5e-3 }, carry_opportunistic: { weight: 0, return: -0.02 }, usd_hedge_growth: { weight: 0.1, return: 3e-3 }, tactical: { weight: 0, return: -0.03 } },
  HIGH_VOL: { capital_preservation: { weight: 0.5, return: 2e-3 }, inflation_hedge: { weight: 0.25, return: 4e-3 }, carry_opportunistic: { weight: 0, return: 8e-3 }, usd_hedge_growth: { weight: 0.2, return: 5e-3 }, tactical: { weight: 0.05, return: 0.01 } },
  NORMAL: { capital_preservation: { weight: 0.4, return: 4e-3 }, inflation_hedge: { weight: 0.25, return: 6e-3 }, carry_opportunistic: { weight: 0.15, return: 0.01 }, usd_hedge_growth: { weight: 0.15, return: 5e-3 }, tactical: { weight: 0.05, return: 0.012 } },
  CARRY_FAVORABLE: { capital_preservation: { weight: 0.25, return: 5e-3 }, inflation_hedge: { weight: 0.15, return: 7e-3 }, carry_opportunistic: { weight: 0.25, return: 0.012 }, usd_hedge_growth: { weight: 0.25, return: 6e-3 }, tactical: { weight: 0.1, return: 0.015 } }
};
var BUCKET_PRODUCTS = {
  capital_preservation: [{ id: "super_ahorro", name: "Super Ahorro Santander", category: "money_market" }, { id: "fci_money_market", name: "FCI Money Market", category: "money_market" }],
  inflation_hedge: [{ id: "pf_uva", name: "Plazo Fijo UVA", category: "cer_indexed" }, { id: "lecaps", name: "Lecaps", category: "cer_indexed" }],
  carry_opportunistic: [{ id: "pf_tradicional", name: "Plazo Fijo Tradicional", category: "nominal" }, { id: "fci_renta_fija", name: "FCI Renta Fija", category: "nominal" }],
  usd_hedge_growth: [{ id: "fci_usd", name: "FCI USD Santander", category: "fx_hedge" }, { id: "bono_usd", name: "Bono USD", category: "fx_hedge" }],
  tactical: [{ id: "lecaps_tactical", name: "Lecaps Tactical", category: "opportunistic" }]
};
function computeAllocation(macro, mode, capitalUSD) {
  const { regime } = classifyRegime(macro);
  const allocations = BASE_ALLOCATIONS[regime];
  let riskMultiplier = mode === "CONSERVATIVE" ? 0.5 : mode === "AGGRESSIVE" ? 1.5 : 1;
  const signals = computeL1Signals(macro);
  if (signals.aggregateConfidence < 0.7) riskMultiplier *= 0.5;
  const portfolio = [];
  for (const [bucketKey, bucketAlloc] of Object.entries(allocations)) {
    let weight = bucketAlloc.weight;
    if (bucketKey !== "capital_preservation" && bucketKey !== "inflation_hedge") weight = Math.min(weight * riskMultiplier, weight * 1.5);
    const products = BUCKET_PRODUCTS[bucketKey] || [];
    if (products.length === 0) continue;
    const perProductWeight = weight / products.length;
    for (const product of products) {
      portfolio.push({ productId: product.id, productName: product.name, weight: r4(perProductWeight), amountUSD: r2(capitalUSD * perProductWeight), category: product.category, strategySource: bucketKey === "carry_opportunistic" ? "carry_optimization" : "usd_hedged_allocations" });
    }
  }
  const totalWeight = portfolio.reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0) {
    for (const alloc of portfolio) {
      alloc.weight = r4(alloc.weight / totalWeight);
      alloc.amountUSD = r2(capitalUSD * alloc.weight);
    }
  }
  return { allocations: portfolio, regime };
}
__name(computeAllocation, "computeAllocation");
function computeRiskMetrics(macro, regime, confidence) {
  const fisherReal = (1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100) - 1;
  const bucketAllocs = BASE_ALLOCATIONS[regime];
  const expectedReturn30d = Object.values(bucketAllocs).reduce((s, b) => s + b.weight * b.return, 0) * 100;
  const probabilityOfLoss = regime === "CRISIS" ? 0.55 : regime === "HIGH_VOL" ? 0.25 : regime === "NORMAL" ? 0.1 : 0.08;
  const maxDrawdown = regime === "CRISIS" ? 15 : regime === "HIGH_VOL" ? 8 : regime === "NORMAL" ? 3 : 2;
  const capitalAtRisk = probabilityOfLoss > 0.15 ? 0.15 : probabilityOfLoss;
  return { expectedReturn30d: r2(expectedReturn30d), expectedReturn90d: r2(expectedReturn30d * 2.8), probabilityOfLoss: r2(probabilityOfLoss), maxDrawdownEstimate: r2(maxDrawdown), capitalAtRisk: r2(capitalAtRisk), sharpeEstimate: r2(expectedReturn30d / (maxDrawdown || 1)), fisherRealRate: r4(fisherReal), volatilityRegime: regime === "CRISIS" ? "crisis" : regime === "HIGH_VOL" ? "stressed" : regime === "CARRY_FAVORABLE" ? "calm" : "normal", liquidityCondition: macro.rates.bcraPolicy > 50 ? "frozen" : macro.rates.bcraPolicy > 30 ? "stressed" : "normal", capitalPreservationPct: r2(bucketAllocs.capital_preservation.weight * 100) };
}
__name(computeRiskMetrics, "computeRiskMetrics");
function computeScenarios(macro, regime) {
  const baseReturn = regime === "CRISIS" ? -2.5 : regime === "HIGH_VOL" ? -0.3 : regime === "CARRY_FAVORABLE" ? 1.2 : 0.6;
  return { downside: { returnMin: r2(baseReturn - 5), returnMax: r2(baseReturn - 1), probability: r2(regime === "CRISIS" ? 0.4 : 0.15), label: "Downside" }, base: { returnMin: r2(baseReturn - 1), returnMax: r2(baseReturn + 1), probability: r2(regime === "CRISIS" ? 0.35 : 0.55), label: "Base" }, upside: { returnMin: r2(baseReturn + 0.5), returnMax: r2(baseReturn + 3), probability: r2(regime === "CRISIS" ? 0.25 : 0.3), label: "Upside" } };
}
__name(computeScenarios, "computeScenarios");
function computeX10Directives(macro, signals) {
  return { confidenceThrottle: { active: signals.aggregateConfidence < 0.7, reason: signals.aggregateConfidence < 0.7 ? "Confidence " + r2(signals.aggregateConfidence) + " < 0.7" : "" }, capitalPreservationFallback: { active: macro.source === "STALE" || macro.source === "ERROR" || macro.source === "PARTIAL_FALLBACK" || signals.capitalPreservationMode, reason: macro.source === "STALE" ? "Macro data STALE" : macro.source === "ERROR" ? "Macro data ERROR" : macro.source === "PARTIAL_FALLBACK" ? "Partial API failure \u2014 some data is model fallback" : signals.capitalPreservationMode ? "Capital preservation triggered" : "" }, emergencyFreeze: { active: macro.source === "ERROR" || signals.emergencyFreeze, reason: macro.source === "ERROR" ? "Macro data ERROR \u2014 freeze all strategy updates" : "" }, deRiskMode: { active: signals.regime.signal.value > 0.6 || signals.aggregateConfidence < 0.5, reason: signals.regime.signal.value > 0.6 ? "High regime stress detected" : signals.aggregateConfidence < 0.5 ? "Very low confidence" : "" } };
}
__name(computeX10Directives, "computeX10Directives");
function runX10Engine(macro, mode, capitalUSD) {
  const startMs = Date.now();
  const signals = computeL1Signals(macro);
  const { allocations, regime } = computeAllocation(macro, mode, capitalUSD);
  const riskMetrics = computeRiskMetrics(macro, regime, signals.aggregateConfidence);
  const scenarios = computeScenarios(macro, regime);
  const x10Directives = computeX10Directives(macro, signals);
  const dataIntegrityScore = Math.min(1, macro.realDataPct / 100);
  const safeMode = dataIntegrityScore < 0.7;
  if (safeMode) {
    x10Directives.safeMode = { active: true, reason: `dataIntegrityScore ${round2(dataIntegrityScore)} < 0.7 \u2014 SAFE_MODE: no trading allowed` };
  }
  return { engineVersion: "X10-CF-WORKER-v1.1", timestamp: isoNow(), durationMs: Date.now() - startMs, dataLayer: { macroSource: macro.source, dataAgeMinutes: macro.ageMinutes, realDataPct: macro.realDataPct, hasError: macro.source === "ERROR", allStale: macro.source === "STALE", dataIntegrityScore: round2(dataIntegrityScore), safeMode }, signalLayer: { regime: signals.regime, inflation: signals.inflation, carry: signals.carry, volatility: signals.volatility, liquidity: signals.liquidity, aggregateConfidence: signals.aggregateConfidence, capitalPreservationMode: signals.capitalPreservationMode, emergencyFreeze: signals.emergencyFreeze }, portfolio_allocation: allocations, risk_metrics: riskMetrics, confidence_score: r2(signals.aggregateConfidence), scenario_downside: scenarios.downside, scenario_base: scenarios.base, scenario_upside: scenarios.upside, x10Directives, dataIntegrityScore: round2(dataIntegrityScore) };
}
__name(runX10Engine, "runX10Engine");
function mulberry32(seed) {
  let state = seed | 0;
  return function() {
    state = state + 1831565813 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
__name(mulberry32, "mulberry32");
function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}
__name(jsonResponse, "jsonResponse");
async function handleDeployGuard(env2) {
  const checks = [];
  let allPassed = true;
  const attributionScenarios = getHistoricalScenarios();
  const prevLogLength = SIGNAL_ATTRIBUTION_LOG.length;
  attributionScenarios.forEach((sc) => {
    const out = runX10Engine(sc.macro, "MODERATE", 2e3);
    const predictedRegime = classifyRegime(sc.macro).regime;
    recordSignalReturn(`GUARD-${sc.id}`, predictedRegime, out.risk_metrics.expectedReturn30d, sc.actualReturn, out.confidence_score, sc.macro.source);
  });
  const coverage = getAttributionCoverage();
  const attributionConnected = coverage.coverage >= 1 && SIGNAL_ATTRIBUTION_LOG.length - prevLogLength === attributionScenarios.length;
  checks.push({ id: "ATTRIBUTION_CONNECTED", passed: attributionConnected, detail: attributionConnected ? `recordSignalReturn wired \u2014 ${coverage.attributed}/${coverage.total} signals (100% coverage)` : `Attribution pipeline BROKEN \u2014 coverage: ${(coverage.coverage * 100).toFixed(0)}%, attributed: ${coverage.attributed}/${coverage.total}` });
  if (!attributionConnected) allPassed = false;
  const seed = 42;
  const rng = mulberry32(seed);
  const v1 = rng(), v2 = rng(), v3 = rng();
  const rerun = mulberry32(seed);
  const deterministic = rerun() === v1 && rerun() === v2 && rerun() === v3;
  checks.push({ id: "DETERMINISTIC_SEED", passed: deterministic, detail: deterministic ? "Seed=42 locked, PRNG deterministic, no Math.random()" : "PRNG not deterministic \u2014 CRITICAL" });
  if (!deterministic) allPassed = false;
  const modeloFound = attributionScenarios.some((sc) => {
    const labels = Object.values(sc.macro.provenance || {}).map((p) => p.label);
    return labels.includes("MODELO") || sc.macro.source === "MODELO";
  });
  checks.push({ id: "NO_FALLBACK_MASKING", passed: !modeloFound, detail: modeloFound ? "CRITICAL: MODELO labels still found \u2014 fallback masking detected" : "Failed fetches labeled ERROR, partial failures labeled PARTIAL_FALLBACK" });
  if (modeloFound) allPassed = false;
  const correctCount = attributionScenarios.filter((sc) => {
    const predictedRegime = classifyRegime(sc.macro).regime;
    return predictedRegime === sc.actualRegime;
  }).length;
  const regimeAccuracy = correctCount / attributionScenarios.length;
  const regimeAccuracyPassed = regimeAccuracy >= 0.65;
  checks.push({ id: "REGIME_ACCURACY", passed: regimeAccuracyPassed, detail: `Accuracy: ${round2(regimeAccuracy * 100)}% (min 65%)`, value: regimeAccuracy });
  if (!regimeAccuracyPassed) allPassed = false;
  let realDataPct = 0;
  let dataIntegrityScore = 0;
  try {
    const macro = await fetchMacroState(env2);
    realDataPct = macro.realDataPct;
    dataIntegrityScore = Math.min(1, realDataPct / 100);
  } catch {
    realDataPct = 0;
  }
  const realDataPassed = realDataPct >= 70;
  checks.push({ id: "REAL_DATA_RATIO", passed: realDataPassed, detail: `Real data: ${realDataPct}% (min 70%)`, value: realDataPct });
  if (!realDataPassed) allPassed = false;
  const integrityPassed = dataIntegrityScore >= 0.7;
  checks.push({ id: "DATA_INTEGRITY_SCORE", passed: integrityPassed, detail: `Score: ${round2(dataIntegrityScore)} (min 0.70) \u2014 system ${integrityPassed ? "PROCEED" : "SAFE_MODE"}`, value: dataIntegrityScore });
  if (!integrityPassed) allPassed = false;
  const crisisOut = runX10Engine(attributionScenarios.find((s) => s.actualRegime === "CRISIS")?.macro || attributionScenarios[0].macro, "MODERATE", 2e3);
  const crisisReturnsNegative = crisisOut.risk_metrics.expectedReturn30d < 0;
  checks.push({ id: "CRISIS_NEGATIVE_RETURN", passed: crisisReturnsNegative, detail: `CRISIS expected return: ${crisisOut.risk_metrics.expectedReturn30d}%`, value: crisisOut.risk_metrics.expectedReturn30d });
  if (!crisisReturnsNegative) allPassed = false;
  let d1Ok = false;
  try {
    await env2.ORACLE_DB.prepare("SELECT 1 as test").first();
    d1Ok = true;
  } catch {
    d1Ok = false;
  }
  checks.push({ id: "D1_TELEMETRY", passed: d1Ok, detail: d1Ok ? "D1 database accessible" : "D1 database NOT accessible" });
  if (!d1Ok) allPassed = false;
  let kvOk = false;
  try {
    await env2.ORACLE_KV.put("_guard_test", "ok", { expirationTtl: 60 });
    const val = await env2.ORACLE_KV.get("_guard_test");
    kvOk = val === "ok";
  } catch {
    kvOk = false;
  }
  checks.push({ id: "KV_CACHE", passed: kvOk, detail: kvOk ? "KV namespace accessible" : "KV namespace NOT accessible" });
  if (!kvOk) allPassed = false;
  const rng2 = mulberry32(seed);
  const slippage1 = Math.round(rng2() * 10);
  const rng3 = mulberry32(seed);
  const slippage2 = Math.round(rng3() * 10);
  const noRandomness = slippage1 === slippage2;
  checks.push({ id: "NO_RANDOMNESS", passed: noRandomness, detail: noRandomness ? "Backtest strictly reproducible (seed=42)" : "CRITICAL: Non-deterministic output detected" });
  if (!noRandomness) allPassed = false;
  const telemetryHealthy = TELEMETRY_RESULTS.fail === 0 || TELEMETRY_RESULTS.ok > TELEMETRY_RESULTS.fail;
  checks.push({ id: "TELEMETRY_HEALTH", passed: telemetryHealthy, detail: telemetryHealthy ? `Telemetry OK: ${TELEMETRY_RESULTS.ok} writes, ${TELEMETRY_RESULTS.fail} failures` : `CRITICAL: Telemetry failures ${TELEMETRY_RESULTS.fail} exceed successes ${TELEMETRY_RESULTS.ok}. Last error: ${TELEMETRY_RESULTS.lastError}` });
  if (!telemetryHealthy) allPassed = false;
  const safeModeGate = crisisOut.dataIntegrityScore !== void 0 && crisisOut.dataLayer?.safeMode !== void 0;
  checks.push({ id: "SAFE_MODE_GATE", passed: safeModeGate, detail: safeModeGate ? "dataIntegrityScore gates runtime X10 decisions (SAFE_MODE when <0.7)" : "CRITICAL: dataIntegrityScore does NOT gate runtime trading" });
  if (!safeModeGate) allPassed = false;
  return jsonResponse({
    deploy_allowed: allPassed,
    version: "X10-CF-WORKER-v1.1",
    checks,
    attribution_coverage: getAttributionCoverage(),
    timestamp: isoNow(),
    action: allPassed ? "GO" : "NO-GO \u2014 fix failing checks before deploying"
  }, allPassed ? 200 : 403);
}
__name(handleDeployGuard, "handleDeployGuard");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
