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

// src/lib/data-fetcher.ts
function validateNumber(val, min, max) {
  const n = typeof val === "number" ? val : NaN;
  if (isNaN(n) || n < min || n > max) throw new Error(`Invalid number: ${val}`);
  return n;
}
__name(validateNumber, "validateNumber");
var STALE_THRESHOLDS = {
  mep: 4,
  // MEP rate: stale after 4 hours
  inflation: 720,
  // INDEC IPC: stale after 30 days (monthly publication)
  rates: 24,
  // BCRA rates: stale after 24 hours
  cer: 48,
  // CER index: stale after 48 hours
  fx: 4,
  // FX rates: stale after 4 hours
  reserves: 48
  // Reserves: stale after 48 hours
};
async function fetchJSON(url, headers) {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json", ...headers }
    });
    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}`, source: url, url, responseTimeMs: Date.now() - start };
    }
    const data = await response.json();
    return { data, error: null, source: url, url, responseTimeMs: Date.now() - start };
  } catch (err) {
    return { data: null, error: String(err), source: url, url, responseTimeMs: Date.now() - start };
  }
}
__name(fetchJSON, "fetchJSON");
async function fetchBluelytics() {
  return fetchJSON("https://api.bluelytics.com.ar/v2/latest");
}
__name(fetchBluelytics, "fetchBluelytics");
async function fetchBCRARates(apiKey) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return fetchJSON("https://api.estadisticasbcra.com.ar/tesoreria", headers);
}
__name(fetchBCRARates, "fetchBCRARates");
async function fetchBCRAFx(apiKey) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return fetchJSON("https://api.estadisticasbcra.com.ar/usd_of", headers);
}
__name(fetchBCRAFx, "fetchBCRAFx");
async function fetchINDECIPC() {
  return fetchJSON("https://apis.datos.gob.ar/series/api/series?ids=148.3_INIVELNAL_DICI_M_26:percent_change&limit=6");
}
__name(fetchINDECIPC, "fetchINDECIPC");
async function fetchCER(apiKey) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return fetchJSON("https://api.estadisticasbcra.com.ar/cer", headers);
}
__name(fetchCER, "fetchCER");
var KV_CACHE_TTL = 300;
async function getCachedMacro(kv) {
  try {
    const cached = await kv.get("macro_state", "json");
    if (cached) {
      const state = cached;
      const ageMinutes = (Date.now() - new Date(state.fetchedAt).getTime()) / 6e4;
      if (ageMinutes < 5) return state;
    }
  } catch {
  }
  return null;
}
__name(getCachedMacro, "getCachedMacro");
async function setCachedMacro(kv, state) {
  try {
    await kv.put("macro_state", JSON.stringify(state), { expirationTtl: KV_CACHE_TTL });
  } catch {
  }
}
__name(setCachedMacro, "setCachedMacro");
function computeStaleness(lastUpdate, thresholdHours) {
  const hours = (Date.now() - new Date(lastUpdate).getTime()) / 36e5;
  const label = hours > thresholdHours * 3 ? "ERROR" : hours > thresholdHours * 2 ? "STALE" : hours > thresholdHours ? "MODELO" : "REAL";
  return { label, stalenessHours: Math.round(hours * 10) / 10 };
}
__name(computeStaleness, "computeStaleness");
function makeProvenance(source, url, label, stalenessHours) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    label,
    source,
    url,
    lastUpdate: now,
    dataDate: now.split("T")[0],
    stalenessHours,
    fetchedAt: now,
    ageMinutes: 0,
    fetchError: false
  };
}
__name(makeProvenance, "makeProvenance");
async function fetchMacroState(env2) {
  const cached = await getCachedMacro(env2.ORACLE_KV);
  if (cached) return cached;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const [bluelyticsResult, bcraRatesResult, bcraFxResult, indecResult, cerResult] = await Promise.allSettled([
    fetchBluelytics(),
    fetchBCRARates(env2.BCRA_API_KEY),
    fetchBCRAFx(env2.BCRA_API_KEY),
    fetchINDECIPC(),
    fetchCER(env2.BCRA_API_KEY)
  ]);
  let mepRate = 1445;
  let officialRate = 1440;
  let mepGap = 0.35;
  let mepSell = 1450;
  let mepBuy = 1440;
  let mepLabel = "MODELO";
  let mepStaleness = 0;
  if (bluelyticsResult.status === "fulfilled" && bluelyticsResult.value.data && !bluelyticsResult.value.error) {
    const b = bluelyticsResult.value.data;
    mepRate = b.blue.value_avg;
    officialRate = b.oficial.value_avg;
    mepSell = b.blue.value_sell;
    mepBuy = b.blue.value_buy;
    mepGap = officialRate > 0 ? (mepRate - officialRate) / officialRate * 100 : 0;
    const staleness = computeStaleness(b.last_update, STALE_THRESHOLDS.mep);
    mepLabel = staleness.label;
    mepStaleness = staleness.stalenessHours;
  } else {
    mepLabel = "ERROR";
  }
  let bcraPolicy = 20;
  let badlar = 22;
  let leliq = 20;
  let tml = 20;
  let moneyMarket = 20;
  let plazoFijo = 19;
  let plazoFijoUVA = 4.5;
  let lecaps = 25;
  let ratesLabel = "MODELO";
  let ratesStaleness = 0;
  if (bcraRatesResult.status === "fulfilled" && bcraRatesResult.value.data && !bcraRatesResult.value.error) {
    const rates = bcraRatesResult.value.data;
    for (const entry of rates) {
      const desc = (entry.descripcion || "").toLowerCase();
      if (desc.includes("tna") || desc.includes("politica")) bcraPolicy = entry.valor;
      else if (desc.includes("badlar")) badlar = entry.valor;
      else if (desc.includes("leliq")) leliq = entry.valor;
      else if (desc.includes("tml")) tml = entry.valor;
      else if (desc.includes("plazo") && desc.includes("fijo")) plazoFijo = entry.valor;
      else if (desc.includes("lecaps")) lecaps = entry.valor;
    }
    moneyMarket = badlar * 0.95;
    ratesLabel = "REAL";
  }
  let inflationMonthly = 2.5;
  let inflationExpected30d = 2.3;
  let inflationExpected90d = 6.9;
  let inflationYearly = 30.5;
  let inflationLabel = "MODELO";
  let inflationStaleness = 0;
  if (indecResult.status === "fulfilled" && indecResult.value.data && !indecResult.value.error) {
    try {
      const ipcData = indecResult.value.data;
      if (ipcData?.data && Array.isArray(ipcData.data) && ipcData.data.length > 0) {
        const latest = ipcData.data[ipcData.data.length - 1];
        inflationMonthly = validateNumber(latest?.valor ?? latest?.[1] ?? 2.5, -5, 50);
        inflationLabel = "REAL";
      }
    } catch {
      inflationLabel = "MODELO";
    }
  }
  let cerIndex = 786;
  let cerMonthlyChange = 2.2;
  let cerDailyChange = 0.07;
  let cerLabel = "MODELO";
  let cerStaleness = 0;
  if (cerResult.status === "fulfilled" && cerResult.value.data && !cerResult.value.error) {
    try {
      const cerData = cerResult.value.data;
      if (Array.isArray(cerData) && cerData.length >= 2) {
        const latest = cerData[cerData.length - 1];
        const prev = cerData[cerData.length - 2];
        cerIndex = latest.valor ?? cerIndex;
        cerMonthlyChange = prev.valor > 0 ? (cerIndex - prev.valor) / prev.valor * 100 : cerMonthlyChange;
        cerDailyChange = cerMonthlyChange / 30;
        cerLabel = "REAL";
      }
    } catch {
      cerLabel = "MODELO";
    }
  }
  const crawlingPeg = 0;
  const reservesMillions = 26e3;
  const dataPoints = [
    mepLabel,
    inflationLabel,
    ratesLabel,
    cerLabel,
    "MODELO",
    // crawlingPeg
    "MODELO",
    // reserves
    "MODELO"
    // PF UVA premium
  ];
  const realCount = dataPoints.filter((d) => d === "REAL").length;
  const realDataPct = Math.round(realCount / dataPoints.length * 100);
  const overallLabel = dataPoints.some((d) => d === "ERROR") ? "ERROR" : dataPoints.some((d) => d === "STALE") ? "STALE" : realDataPct >= 60 ? "REAL" : realDataPct >= 30 ? "MODELO" : "SIMULADO";
  const macroState = {
    lastUpdate: now,
    fetchedAt: now,
    ageMinutes: 0,
    lastSuccessfulFetch: now,
    source: overallLabel,
    mep: {
      rate: Math.round(mepRate * 100) / 100,
      officialRate: Math.round(officialRate * 100) / 100,
      gap: Math.round(mepGap * 100) / 100,
      sell: Math.round(mepSell * 100) / 100,
      buy: Math.round(mepBuy * 100) / 100
    },
    inflation: {
      monthly: Math.round(inflationMonthly * 100) / 100,
      expected30d: Math.round(inflationExpected30d * 100) / 100,
      expected90d: Math.round(inflationExpected90d * 100) / 100,
      yearly: Math.round(inflationYearly * 100) / 100
    },
    rates: {
      bcraPolicy: Math.round(bcraPolicy * 100) / 100,
      moneyMarket: Math.round(moneyMarket * 100) / 100,
      plazoFijo: Math.round(plazoFijo * 100) / 100,
      plazoFijoUVA: Math.round(plazoFijoUVA * 100) / 100,
      lecaps: Math.round(lecaps * 100) / 100,
      badlar: Math.round(badlar * 100) / 100,
      leliq: Math.round(leliq * 100) / 100,
      tml: Math.round(tml * 100) / 100
    },
    cer: {
      index: Math.round(cerIndex * 100) / 100,
      monthlyChange: Math.round(cerMonthlyChange * 100) / 100,
      dailyChange: Math.round(cerDailyChange * 1e4) / 1e4
    },
    crawlingPeg,
    realDataPct,
    provenance: {
      mepRate: makeProvenance("Bluelytics API", "https://api.bluelytics.com.ar/v2/latest", mepLabel, mepStaleness),
      inflation: makeProvenance("INDEC API", "https://apis.datos.gob.ar/series/api/series", inflationLabel, inflationStaleness),
      rates: makeProvenance("BCRA API", "https://api.estadisticasbcra.com.ar/tesoreria", ratesLabel, ratesStaleness),
      cer: makeProvenance("BCRA API", "https://api.estadisticasbcra.com.ar/cer", cerLabel, cerStaleness),
      crawlingPeg: makeProvenance("MODEL", "N/A", "MODELO", 0),
      reserves: makeProvenance("MODEL", "N/A", "MODELO", 0)
    }
  };
  await setCachedMacro(env2.ORACLE_KV, macroState);
  return macroState;
}
__name(fetchMacroState, "fetchMacroState");

// src/lib/engine.ts
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
__name(clamp01, "clamp01");
function round2(x) {
  return Math.round(x * 100) / 100;
}
__name(round2, "round2");
function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}
__name(round4, "round4");
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(isoNow, "isoNow");
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
    { name: "Tipo de cambio", value: round2(fxMomentum), weight: 0.35, contribution: round2(fxMomentum * 0.35), direction: fxMomentum > 50 ? "bajista" : fxMomentum > 25 ? "neutral" : "alcista" },
    { name: "Inflaci\xF3n", value: round2(inflationAccel), weight: 0.25, contribution: round2(inflationAccel * 0.25), direction: inflationAccel > 50 ? "bajista" : inflationAccel > 25 ? "neutral" : "alcista" },
    { name: "Reservas", value: round2(reservePressure), weight: 0.2, contribution: round2(reservePressure * 0.2), direction: reservePressure > 50 ? "bajista" : reservePressure > 25 ? "neutral" : "alcista" },
    { name: "Tasas", value: round2(rateGapUSD), weight: 0.2, contribution: round2(rateGapUSD * 0.2), direction: rateGapUSD > 70 ? "bajista" : rateGapUSD > 40 ? "neutral" : "alcista" }
  ];
  return {
    regime,
    devaluationProbability: round2(devaluationProbability),
    devaluationRiskBand,
    confidenceScore,
    fxMomentum: round2(fxMomentum),
    inflationAcceleration: round2(inflationAccel),
    reservePressure: round2(reservePressure),
    rateGapUSD: round2(rateGapUSD),
    timestamp: isoNow(),
    source: macro.source,
    signals,
    dataQualityPct: Math.round(dataQuality)
  };
}
__name(computeOracle, "computeOracle");
function determineRegime(macro, devalProb) {
  if (macro.source === "ERROR") return "CRISIS";
  if (devalProb > 75) return "CRISIS";
  if (devalProb > 50) return "WARNING";
  if (macro.mep.gap > 50) return "HIGH_VOL";
  const fisherReal = (1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100) - 1;
  if (fisherReal > 0.01 && macro.inflation.monthly < 4 && macro.mep.gap < 25) return "CARRY_FAVORABLE";
  if (fisherReal > 5e-3 && macro.inflation.monthly < 5) return "CARRY";
  return "NORMAL";
}
__name(determineRegime, "determineRegime");
function computeSignalAgreement(fx, infl, reserves, rates) {
  const values = [fx, infl, reserves, rates];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const maxVariance = 2500;
  return clamp01(1 - variance / maxVariance) * 100;
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
  const regimeSignal = {
    value: clamp01(oracle.devaluationProbability / 100),
    strength: oracle.devaluationProbability > 75 ? "extreme" : oracle.devaluationProbability > 50 ? "high" : oracle.devaluationProbability > 25 ? "medium" : "low",
    direction: oracle.devaluationProbability > 50 ? "accelerating" : oracle.devaluationProbability > 25 ? "stable" : "decelerating",
    confidence: oracle.confidenceScore / 100,
    sourceLabel: macro.source,
    drivers: ["fx_gap", "inflation", "reserves", "rate_spread"],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.source === "STALE" || macro.source === "ERROR"
  };
  const inflationSignal = {
    value: clamp01(macro.inflation.expected30d / 10),
    strength: macro.inflation.expected30d > 8 ? "extreme" : macro.inflation.expected30d > 5 ? "high" : macro.inflation.expected30d > 3 ? "medium" : "low",
    direction: macro.inflation.expected30d > macro.inflation.monthly ? "accelerating" : macro.inflation.expected30d < macro.inflation.monthly * 0.8 ? "decelerating" : "stable",
    confidence: macro.provenance.inflation.label === "REAL" ? 0.9 : macro.provenance.inflation.label === "STALE" ? 0.3 : 0.5,
    sourceLabel: macro.provenance.inflation.label,
    drivers: ["ipc_mensual", "expectativas_30d"],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.provenance.inflation.label === "STALE" || macro.provenance.inflation.label === "ERROR"
  };
  const fisherReal = (1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100) - 1;
  const carrySignal = {
    value: clamp01(fisherReal * 50 + 0.5),
    // Normalize: 0 = negative carry, 1 = strong positive carry
    strength: fisherReal > 0.02 ? "extreme" : fisherReal > 0.01 ? "high" : fisherReal > 0 ? "medium" : "low",
    direction: fisherReal > 5e-3 ? "accelerating" : fisherReal < -5e-3 ? "reversing" : "stable",
    confidence: macro.provenance.rates.label === "REAL" && macro.provenance.inflation.label === "REAL" ? 0.85 : 0.4,
    sourceLabel: macro.source,
    drivers: ["fisher_real_rate", "money_market_tna", "inflation"],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.source === "STALE" || macro.source === "ERROR"
  };
  const gapVol = macro.mep.gap;
  const volRegime = gapVol > 80 ? "crisis" : gapVol > 50 ? "stressed" : gapVol > 25 ? "elevated" : gapVol > 10 ? "normal" : "calm";
  const volatilitySignal = {
    value: clamp01(gapVol / 80),
    strength: volRegime === "crisis" ? "extreme" : volRegime === "stressed" ? "high" : volRegime === "elevated" ? "medium" : "low",
    direction: macro.mep.gap > 30 ? "accelerating" : "stable",
    confidence: macro.provenance.mepRate.label === "REAL" ? 0.85 : 0.4,
    sourceLabel: macro.provenance.mepRate.label,
    drivers: ["mep_gap", "fx_volatility"],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.provenance.mepRate.label === "STALE"
  };
  const liqRegime = macro.rates.bcraPolicy > 50 ? "frozen" : macro.rates.bcraPolicy > 30 ? "stressed" : macro.rates.bcraPolicy > 15 ? "tight" : macro.rates.bcraPolicy > 5 ? "normal" : "abundant";
  const liquiditySignal = {
    value: clamp01(macro.rates.bcraPolicy / 50),
    strength: liqRegime === "frozen" ? "extreme" : liqRegime === "stressed" ? "high" : liqRegime === "tight" ? "medium" : "low",
    direction: macro.rates.bcraPolicy > 30 ? "accelerating" : "decelerating",
    confidence: macro.provenance.rates.label === "REAL" ? 0.8 : 0.4,
    sourceLabel: macro.provenance.rates.label,
    drivers: ["bcra_policy_rate", "leliq", "badlar"],
    timestamp: now,
    dataAgeMinutes: macro.ageMinutes,
    isDiscounted: macro.provenance.rates.label === "STALE"
  };
  const allConfidences = [regimeSignal.confidence, inflationSignal.confidence, carrySignal.confidence, volatilitySignal.confidence, liquiditySignal.confidence];
  const aggregateConfidence = allConfidences.reduce((s, c) => s + c, 0) / allConfidences.length;
  const capitalPreservationMode = macro.source === "STALE" || macro.source === "ERROR" || aggregateConfidence < 0.5;
  const emergencyFreeze = macro.source === "ERROR";
  return {
    regime: { regime: regimeX10, signal: regimeSignal },
    inflation: { name: "inflation", signal: inflationSignal },
    carry: { name: "carry", signal: carrySignal },
    volatility: { name: "volatility", signal: volatilitySignal },
    liquidity: { name: "liquidity", signal: liquiditySignal },
    aggregateConfidence: round2(aggregateConfidence),
    capitalPreservationMode,
    emergencyFreeze
  };
}
__name(computeL1Signals, "computeL1Signals");
var BASE_ALLOCATIONS = {
  CRISIS: {
    capital_preservation: { weight: 0.8, return: 6e-3 },
    inflation_hedge: { weight: 0.1, return: 9e-3 },
    carry_opportunistic: { weight: 0, return: 0.015 },
    usd_hedge_growth: { weight: 0.1, return: 8e-3 },
    tactical: { weight: 0, return: 0.02 }
  },
  HIGH_VOL: {
    capital_preservation: { weight: 0.5, return: 6e-3 },
    inflation_hedge: { weight: 0.25, return: 9e-3 },
    carry_opportunistic: { weight: 0, return: 0.015 },
    // Disabled in HIGH_VOL
    usd_hedge_growth: { weight: 0.2, return: 8e-3 },
    tactical: { weight: 0.05, return: 0.02 }
  },
  NORMAL: {
    capital_preservation: { weight: 0.4, return: 6e-3 },
    inflation_hedge: { weight: 0.25, return: 9e-3 },
    carry_opportunistic: { weight: 0.15, return: 0.015 },
    usd_hedge_growth: { weight: 0.15, return: 8e-3 },
    tactical: { weight: 0.05, return: 0.02 }
  },
  CARRY_FAVORABLE: {
    capital_preservation: { weight: 0.25, return: 6e-3 },
    inflation_hedge: { weight: 0.15, return: 9e-3 },
    carry_opportunistic: { weight: 0.25, return: 0.015 },
    // Expanded in carry
    usd_hedge_growth: { weight: 0.25, return: 8e-3 },
    tactical: { weight: 0.1, return: 0.02 }
  }
};
var BUCKET_PRODUCTS = {
  capital_preservation: [
    { id: "super_ahorro", name: "Super Ahorro Santander", category: "money_market" },
    { id: "fci_money_market", name: "FCI Money Market", category: "money_market" }
  ],
  inflation_hedge: [
    { id: "pf_uva", name: "Plazo Fijo UVA", category: "cer_indexed" },
    { id: "lecaps", name: "Lecaps", category: "cer_indexed" }
  ],
  carry_opportunistic: [
    { id: "pf_tradicional", name: "Plazo Fijo Tradicional", category: "nominal" },
    { id: "fci_renta_fija", name: "FCI Renta Fija", category: "nominal" }
  ],
  usd_hedge_growth: [
    { id: "fci_usd", name: "FCI USD Santander", category: "fx_hedge" },
    { id: "bono_usd", name: "Bono USD", category: "fx_hedge" }
  ],
  tactical: [
    { id: "lecaps_tactical", name: "Lecaps Tactical", category: "opportunistic" }
  ]
};
function computeAllocation(macro, mode, capitalUSD) {
  const { regime } = classifyRegime(macro);
  const allocations = BASE_ALLOCATIONS[regime];
  let riskMultiplier = mode === "CONSERVATIVE" ? 0.5 : mode === "AGGRESSIVE" ? 1.5 : 1;
  const signals = computeL1Signals(macro);
  if (signals.aggregateConfidence < 0.7) {
    riskMultiplier *= 0.5;
  }
  const portfolio = [];
  for (const [bucketKey, bucketAlloc] of Object.entries(allocations)) {
    let weight = bucketAlloc.weight;
    if (bucketKey !== "capital_preservation" && bucketKey !== "inflation_hedge") {
      weight = Math.min(weight * riskMultiplier, weight * 1.5);
    }
    const products = BUCKET_PRODUCTS[bucketKey] || [];
    if (products.length === 0) continue;
    const perProductWeight = weight / products.length;
    for (const product of products) {
      portfolio.push({
        productId: product.id,
        productName: product.name,
        weight: round4(perProductWeight),
        amountUSD: round2(capitalUSD * perProductWeight),
        category: product.category,
        strategySource: bucketKey === "carry_opportunistic" ? "carry_optimization" : "usd_hedged_allocations"
      });
    }
  }
  const totalWeight = portfolio.reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0) {
    for (const alloc of portfolio) {
      alloc.weight = round4(alloc.weight / totalWeight);
      alloc.amountUSD = round2(capitalUSD * alloc.weight);
    }
  }
  return { allocations: portfolio, regime };
}
__name(computeAllocation, "computeAllocation");
function computeRiskMetrics(macro, regime, confidence) {
  const fisherReal = (1 + macro.rates.moneyMarket / 12) / (1 + macro.inflation.monthly / 100) - 1;
  const bucketAllocs = BASE_ALLOCATIONS[regime];
  const expectedReturn30d = Object.values(bucketAllocs).reduce((s, b) => s + b.weight * b.return, 0) * 100;
  const probabilityOfLoss = regime === "CRISIS" ? 0.35 : regime === "HIGH_VOL" ? 0.2 : regime === "NORMAL" ? 0.1 : 0.08;
  const maxDrawdown = regime === "CRISIS" ? 12 : regime === "HIGH_VOL" ? 8 : regime === "NORMAL" ? 3 : 2;
  const capitalAtRisk = probabilityOfLoss > 0.15 ? 0.15 : probabilityOfLoss;
  return {
    expectedReturn30d: round2(expectedReturn30d),
    expectedReturn90d: round2(expectedReturn30d * 2.8),
    probabilityOfLoss: round2(probabilityOfLoss),
    maxDrawdownEstimate: round2(maxDrawdown),
    capitalAtRisk: round2(capitalAtRisk),
    sharpeEstimate: round2(expectedReturn30d / (maxDrawdown || 1)),
    fisherRealRate: round4(fisherReal),
    volatilityRegime: regime === "CRISIS" ? "crisis" : regime === "HIGH_VOL" ? "stressed" : regime === "CARRY_FAVORABLE" ? "calm" : "normal",
    liquidityCondition: macro.rates.bcraPolicy > 50 ? "frozen" : macro.rates.bcraPolicy > 30 ? "stressed" : "normal",
    capitalPreservationPct: round2(bucketAllocs.capital_preservation.weight * 100)
  };
}
__name(computeRiskMetrics, "computeRiskMetrics");
function computeScenarios(macro, regime) {
  const baseReturn = regime === "CRISIS" ? -3 : regime === "HIGH_VOL" ? -0.5 : regime === "CARRY_FAVORABLE" ? 1.5 : 0.8;
  return {
    downside: {
      returnMin: round2(baseReturn - 5),
      returnMax: round2(baseReturn - 1),
      probability: round2(regime === "CRISIS" ? 0.35 : 0.15),
      label: "Downside"
    },
    base: {
      returnMin: round2(baseReturn - 1),
      returnMax: round2(baseReturn + 1),
      probability: round2(regime === "CRISIS" ? 0.4 : 0.55),
      label: "Base"
    },
    upside: {
      returnMin: round2(baseReturn + 0.5),
      returnMax: round2(baseReturn + 3),
      probability: round2(regime === "CRISIS" ? 0.25 : 0.3),
      label: "Upside"
    }
  };
}
__name(computeScenarios, "computeScenarios");
function computeX10Directives(macro, signals) {
  return {
    confidenceThrottle: {
      active: signals.aggregateConfidence < 0.7,
      reason: signals.aggregateConfidence < 0.7 ? `Confidence ${round2(signals.aggregateConfidence)} < 0.7 threshold` : ""
    },
    capitalPreservationFallback: {
      active: macro.source === "STALE" || macro.source === "ERROR" || signals.capitalPreservationMode,
      reason: macro.source === "STALE" ? "Macro data STALE" : macro.source === "ERROR" ? "Macro data ERROR" : signals.capitalPreservationMode ? "Capital preservation triggered" : ""
    },
    emergencyFreeze: {
      active: macro.source === "ERROR" || signals.emergencyFreeze,
      reason: macro.source === "ERROR" ? "Macro data ERROR \u2014 freeze all strategy updates" : ""
    },
    deRiskMode: {
      active: signals.regime.signal.value > 0.6 || signals.aggregateConfidence < 0.5,
      reason: signals.regime.signal.value > 0.6 ? "High regime stress detected" : signals.aggregateConfidence < 0.5 ? "Very low confidence" : ""
    }
  };
}
__name(computeX10Directives, "computeX10Directives");
function runX10Engine(macro, mode, capitalUSD) {
  const startMs = Date.now();
  const signals = computeL1Signals(macro);
  const { allocations, regime } = computeAllocation(macro, mode, capitalUSD);
  const riskMetrics = computeRiskMetrics(macro, regime, signals.aggregateConfidence);
  const scenarios = computeScenarios(macro, regime);
  const x10Directives = computeX10Directives(macro, signals);
  return {
    engineVersion: "X10-CF-WORKER-v1.0",
    timestamp: isoNow(),
    durationMs: Date.now() - startMs,
    dataLayer: {
      macroSource: macro.source,
      dataAgeMinutes: macro.ageMinutes,
      realDataPct: macro.realDataPct,
      hasError: macro.source === "ERROR",
      allStale: macro.source === "STALE"
    },
    signalLayer: {
      regime: signals.regime,
      inflation: signals.inflation,
      carry: signals.carry,
      volatility: signals.volatility,
      liquidity: signals.liquidity,
      aggregateConfidence: signals.aggregateConfidence,
      capitalPreservationMode: signals.capitalPreservationMode,
      emergencyFreeze: signals.emergencyFreeze
    },
    portfolio_allocation: allocations,
    risk_metrics: riskMetrics,
    confidence_score: round2(signals.aggregateConfidence),
    scenario_downside: scenarios.downside,
    scenario_base: scenarios.base,
    scenario_upside: scenarios.upside,
    x10Directives
  };
}
__name(runX10Engine, "runX10Engine");

// src/lib/seeded-rng.ts
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

// src/worker.ts
var worker_default = {
  async fetch(request, env2, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    try {
      if (path === "/api/macro" && request.method === "GET") {
        return await handleMacro(env2, ctx);
      }
      if (path === "/api/x10" && request.method === "POST") {
        return await handleX10(request, env2, ctx);
      }
      if (path === "/api/regime" && request.method === "GET") {
        return await handleRegime(env2, ctx);
      }
      if (path === "/api/backtest-lite" && request.method === "GET") {
        return await handleBacktestLite(env2, url);
      }
      if (path === "/api/health" && request.method === "GET") {
        return jsonResponse({ status: "ok", version: "X10-CF-WORKER-v1.0", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
      }
      return jsonResponse({ error: "Not Found", path }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return jsonResponse({
        error: "INTERNAL_ERROR",
        message,
        failsafe: "If API fetch failed, stale cached macro_state should be used",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }, 500);
    }
  }
};
async function handleMacro(env2, ctx) {
  const macro = await fetchMacroState(env2);
  const { regime, confidence, oracle } = classifyRegime(macro);
  const staleness_report = {};
  for (const [key, prov] of Object.entries(macro.provenance)) {
    staleness_report[key] = { label: prov.label, stalenessHours: prov.stalenessHours };
  }
  ctx.waitUntil(logMacroSnapshot(env2, macro, regime, confidence));
  const response = {
    macro_state: macro,
    staleness_report,
    regime,
    confidence: Math.round(confidence * 100) / 100,
    oracle,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  return jsonResponse(response);
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
  if (capital < 100 || capital > 1e6) {
    return jsonResponse({ error: "Capital must be between 100 and 1,000,000 USD" }, 400);
  }
  const macro = await fetchMacroState(env2);
  const engineOutput = runX10Engine(macro, mode, capital);
  ctx.waitUntil(logDecision(env2, engineOutput, mode, capital));
  const response = {
    allocation: engineOutput.portfolio_allocation,
    risk_metrics: engineOutput.risk_metrics,
    confidence: engineOutput.confidence_score,
    stress_scenarios: {
      downside: engineOutput.scenario_downside,
      base: engineOutput.scenario_base,
      upside: engineOutput.scenario_upside
    },
    x10_directives: engineOutput.x10Directives,
    timestamp: engineOutput.timestamp
  };
  return jsonResponse(response);
}
__name(handleX10, "handleX10");
async function handleRegime(env2, ctx) {
  const macro = await fetchMacroState(env2);
  const { regime, confidence, oracle } = classifyRegime(macro);
  let regime_history = [];
  try {
    const result = await env2.ORACLE_DB.prepare("SELECT timestamp, regime, confidence FROM regime_history ORDER BY timestamp DESC LIMIT 30").all();
    regime_history = (result.results || []).map((r) => ({
      timestamp: r.timestamp,
      regime: r.regime,
      confidence: r.confidence
    }));
  } catch {
  }
  const transition_probability = computeTransitionProbability(regime);
  ctx.waitUntil(logRegimeObservation(env2, regime, confidence, macro));
  const response = {
    current_regime: regime,
    regime_history,
    transition_probability,
    oracle,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  return jsonResponse(response);
}
__name(handleRegime, "handleRegime");
async function handleBacktestLite(env2, url) {
  const seedParam = url.searchParams.get("seed");
  const seed = seedParam ? parseInt(seedParam, 10) : 42;
  const modeParam = url.searchParams.get("mode") || "MODERATE";
  const mode = ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"].includes(modeParam) ? modeParam : "MODERATE";
  const rng = mulberry32(seed);
  const scenarios = getHistoricalScenarios();
  const results = scenarios.map((scenario) => {
    const engineOutput = runX10Engine(scenario.macro, mode, 2e3);
    const predictedRegime = classifyRegime(scenario.macro).regime;
    const regimeCorrect = predictedRegime === scenario.actualRegime;
    return {
      id: scenario.id,
      label: scenario.label,
      predicted_regime: predictedRegime,
      actual_regime: scenario.actualRegime,
      regime_correct: regimeCorrect,
      predicted_return: engineOutput.risk_metrics.expectedReturn30d,
      actual_return: scenario.actualReturn,
      confidence: engineOutput.confidence_score
    };
  });
  const regimeAccuracy = results.filter((r) => r.regime_correct).length / results.length;
  const response = {
    seed,
    mode,
    total_scenarios: results.length,
    regime_accuracy: Math.round(regimeAccuracy * 100) / 100,
    results,
    disclaimer: "BACKTEST RESULTS ARE HYPOTHETICAL. Historical macro states are model-constructed, not observed. Past performance does not guarantee future results.",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  return jsonResponse(response);
}
__name(handleBacktestLite, "handleBacktestLite");
function computeTransitionProbability(currentRegime) {
  const transitions = {
    CRISIS: { CRISIS: 0.4, HIGH_VOL: 0.35, NORMAL: 0.15, CARRY_FAVORABLE: 0.1 },
    HIGH_VOL: { CRISIS: 0.2, HIGH_VOL: 0.4, NORMAL: 0.3, CARRY_FAVORABLE: 0.1 },
    NORMAL: { CRISIS: 0.05, HIGH_VOL: 0.15, NORMAL: 0.55, CARRY_FAVORABLE: 0.25 },
    CARRY_FAVORABLE: { CRISIS: 0.03, HIGH_VOL: 0.07, NORMAL: 0.3, CARRY_FAVORABLE: 0.6 }
  };
  return transitions[currentRegime] || transitions.NORMAL;
}
__name(computeTransitionProbability, "computeTransitionProbability");
function getHistoricalScenarios() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const makeProvenance2 = /* @__PURE__ */ __name((label) => ({
    label,
    source: "Historical",
    url: "N/A",
    lastUpdate: now,
    dataDate: now.split("T")[0],
    stalenessHours: 0,
    fetchedAt: now,
    ageMinutes: 0,
    fetchError: false
  }), "makeProvenance");
  return [
    {
      id: "paso-2023",
      label: "PASO Elections 2023",
      actualRegime: "CRISIS",
      actualReturn: -8.5,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "MODELO",
        mep: { rate: 750, officialRate: 350, gap: 114, sell: 780, buy: 720 },
        inflation: { monthly: 12.4, expected30d: 15, expected90d: 45, yearly: 125 },
        rates: { bcraPolicy: 118, moneyMarket: 115, plazoFijo: 97, plazoFijoUVA: 5.5, lecaps: 120, badlar: 100, leliq: 118, tml: 98 },
        cer: { index: 340, monthlyChange: 12, dailyChange: 0.38 },
        crawlingPeg: 5,
        realDataPct: 40,
        provenance: { mepRate: makeProvenance2("MODELO"), inflation: makeProvenance2("MODELO"), rates: makeProvenance2("MODELO"), cer: makeProvenance2("MODELO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("MODELO") }
      }
    },
    {
      id: "milei-transition",
      label: "Milei Transition 2023",
      actualRegime: "HIGH_VOL",
      actualReturn: -3.2,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "MODELO",
        mep: { rate: 1e3, officialRate: 800, gap: 25, sell: 1020, buy: 980 },
        inflation: { monthly: 25, expected30d: 20, expected90d: 40, yearly: 280 },
        rates: { bcraPolicy: 133, moneyMarket: 130, plazoFijo: 110, plazoFijoUVA: 3, lecaps: 135, badlar: 120, leliq: 133, tml: 118 },
        cer: { index: 420, monthlyChange: 25, dailyChange: 0.75 },
        crawlingPeg: 2,
        realDataPct: 40,
        provenance: { mepRate: makeProvenance2("MODELO"), inflation: makeProvenance2("MODELO"), rates: makeProvenance2("MODELO"), cer: makeProvenance2("MODELO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("MODELO") }
      }
    },
    {
      id: "stabilization-2024",
      label: "Stabilization 2024",
      actualRegime: "NORMAL",
      actualReturn: 0.8,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "MODELO",
        mep: { rate: 1100, officialRate: 870, gap: 26, sell: 1110, buy: 1090 },
        inflation: { monthly: 8.8, expected30d: 6, expected90d: 12, yearly: 140 },
        rates: { bcraPolicy: 40, moneyMarket: 38, plazoFijo: 35, plazoFijoUVA: 3.5, lecaps: 42, badlar: 36, leliq: 40, tml: 34 },
        cer: { index: 530, monthlyChange: 8.5, dailyChange: 0.28 },
        crawlingPeg: 2,
        realDataPct: 40,
        provenance: { mepRate: makeProvenance2("MODELO"), inflation: makeProvenance2("MODELO"), rates: makeProvenance2("MODELO"), cer: makeProvenance2("MODELO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("MODELO") }
      }
    },
    {
      id: "carry-2024",
      label: "Carry Favorable 2024",
      actualRegime: "CARRY_FAVORABLE",
      actualReturn: 1.4,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "MODELO",
        mep: { rate: 1200, officialRate: 1010, gap: 19, sell: 1210, buy: 1190 },
        inflation: { monthly: 2.7, expected30d: 2.5, expected90d: 7.5, yearly: 55 },
        rates: { bcraPolicy: 32, moneyMarket: 30, plazoFijo: 28, plazoFijoUVA: 4, lecaps: 35, badlar: 29, leliq: 32, tml: 27 },
        cer: { index: 620, monthlyChange: 2.5, dailyChange: 0.08 },
        crawlingPeg: 1,
        realDataPct: 40,
        provenance: { mepRate: makeProvenance2("MODELO"), inflation: makeProvenance2("MODELO"), rates: makeProvenance2("MODELO"), cer: makeProvenance2("MODELO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("MODELO") }
      }
    },
    {
      id: "bandas-2026",
      label: "Bandas Cambiarias 2026",
      actualRegime: "NORMAL",
      actualReturn: 0.7,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "MODELO",
        mep: { rate: 1445, officialRate: 1440, gap: 0.35, sell: 1450, buy: 1440 },
        inflation: { monthly: 2.5, expected30d: 2.3, expected90d: 6.9, yearly: 30.5 },
        rates: { bcraPolicy: 20, moneyMarket: 20, plazoFijo: 19, plazoFijoUVA: 4.5, lecaps: 25, badlar: 22, leliq: 20, tml: 20 },
        cer: { index: 786, monthlyChange: 2.2, dailyChange: 0.07 },
        crawlingPeg: 0,
        realDataPct: 30,
        provenance: { mepRate: makeProvenance2("MODELO"), inflation: makeProvenance2("MODELO"), rates: makeProvenance2("MODELO"), cer: makeProvenance2("MODELO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("MODELO") }
      }
    },
    {
      id: "stress-deval",
      label: "Stress: Sudden Devaluation",
      actualRegime: "CRISIS",
      actualReturn: -6,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "SIMULADO",
        mep: { rate: 1878, officialRate: 1440, gap: 30.4, sell: 1900, buy: 1850 },
        inflation: { monthly: 8, expected30d: 10, expected90d: 25, yearly: 80 },
        rates: { bcraPolicy: 45, moneyMarket: 42, plazoFijo: 38, plazoFijoUVA: 5, lecaps: 48, badlar: 40, leliq: 45, tml: 38 },
        cer: { index: 830, monthlyChange: 7.5, dailyChange: 0.24 },
        crawlingPeg: 0,
        realDataPct: 10,
        provenance: { mepRate: makeProvenance2("SIMULADO"), inflation: makeProvenance2("SIMULADO"), rates: makeProvenance2("SIMULADO"), cer: makeProvenance2("SIMULADO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("SIMULADO") }
      }
    },
    {
      id: "stress-recession",
      label: "Stress: Prolonged Recession",
      actualRegime: "NORMAL",
      actualReturn: 0.3,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "SIMULADO",
        mep: { rate: 1500, officialRate: 1460, gap: 2.7, sell: 1510, buy: 1490 },
        inflation: { monthly: 1.8, expected30d: 1.5, expected90d: 4.5, yearly: 22 },
        rates: { bcraPolicy: 15, moneyMarket: 14, plazoFijo: 12, plazoFijoUVA: 3, lecaps: 18, badlar: 13, leliq: 15, tml: 12 },
        cer: { index: 810, monthlyChange: 1.6, dailyChange: 0.05 },
        crawlingPeg: 0,
        realDataPct: 20,
        provenance: { mepRate: makeProvenance2("SIMULADO"), inflation: makeProvenance2("SIMULADO"), rates: makeProvenance2("SIMULADO"), cer: makeProvenance2("SIMULADO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("SIMULADO") }
      }
    },
    {
      id: "stress-inflation",
      label: "Stress: Inflation Resurgence",
      actualRegime: "HIGH_VOL",
      actualReturn: -1.5,
      macro: {
        lastUpdate: now,
        fetchedAt: now,
        ageMinutes: 0,
        lastSuccessfulFetch: now,
        source: "SIMULADO",
        mep: { rate: 1550, officialRate: 1450, gap: 6.9, sell: 1560, buy: 1540 },
        inflation: { monthly: 5, expected30d: 6, expected90d: 18, yearly: 60 },
        rates: { bcraPolicy: 30, moneyMarket: 28, plazoFijo: 25, plazoFijoUVA: 5.5, lecaps: 33, badlar: 26, leliq: 30, tml: 24 },
        cer: { index: 850, monthlyChange: 4.8, dailyChange: 0.16 },
        crawlingPeg: 0.5,
        realDataPct: 20,
        provenance: { mepRate: makeProvenance2("SIMULADO"), inflation: makeProvenance2("SIMULADO"), rates: makeProvenance2("SIMULADO"), cer: makeProvenance2("SIMULADO"), crawlingPeg: makeProvenance2("SIMULADO"), reserves: makeProvenance2("SIMULADO") }
      }
    }
  ];
}
__name(getHistoricalScenarios, "getHistoricalScenarios");
async function logMacroSnapshot(env2, macro, regime, confidence) {
  try {
    await env2.ORACLE_DB.prepare(`
      INSERT INTO macro_snapshots (id, source, data_label, mep_rate, official_rate, mep_gap,
        inflation_monthly, inflation_expected30d, bcra_policy_rate, money_market_tna,
        plazo_fijo_tna, plazo_fijo_uva_premium, lecaps_tna, badlar_tna, leliq_tna,
        cer_index, cer_monthly_change, crawling_peg, real_data_pct, staleness_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `MS-${Date.now()}`,
      "worker",
      macro.source,
      macro.mep.rate,
      macro.mep.officialRate,
      macro.mep.gap,
      macro.inflation.monthly,
      macro.inflation.expected30d,
      macro.rates.bcraPolicy,
      macro.rates.moneyMarket,
      macro.rates.plazoFijo,
      macro.rates.plazoFijoUVA,
      macro.rates.lecaps,
      macro.rates.badlar,
      macro.rates.leliq,
      macro.cer.index,
      macro.cer.monthlyChange,
      macro.crawlingPeg,
      macro.realDataPct,
      0
    ).run();
  } catch {
  }
}
__name(logMacroSnapshot, "logMacroSnapshot");
async function logDecision(env2, output, mode, capital) {
  try {
    await env2.ORACLE_DB.prepare(`
      INSERT INTO decisions_log (id, decision_type, severity, summary, action, reasoning_json,
        context_json, data_quality, confidence, regime, active_directives_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `DEC-${Date.now()}`,
      "ALLOCATION_COMPUTED",
      "info",
      `X10 allocation: mode=${mode}, capital=$${capital}`,
      `Computed allocation with ${output.portfolio_allocation.length} positions`,
      JSON.stringify([`Mode: ${mode}`, `Confidence: ${output.confidence_score}`, `Regime: ${output.signalLayer.regime.regime}`]),
      JSON.stringify({ dataAgeMinutes: output.dataLayer.dataAgeMinutes, realDataPct: output.dataLayer.realDataPct }),
      output.dataLayer.macroSource,
      output.confidence_score,
      output.signalLayer.regime.regime,
      JSON.stringify(Object.entries(output.x10Directives).filter(([, v]) => v.active).map(([k]) => k))
    ).run();
  } catch {
  }
}
__name(logDecision, "logDecision");
async function logRegimeObservation(env2, regime, confidence, macro) {
  try {
    await env2.ORACLE_DB.prepare(`
      INSERT INTO regime_history (id, regime, confidence, data_quality, mep_rate, inflation_monthly, bcra_policy_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `RH-${Date.now()}`,
      regime,
      confidence,
      macro.source,
      macro.mep.rate,
      macro.inflation.monthly,
      macro.rates.bcraPolicy
    ).run();
  } catch {
  }
}
__name(logRegimeObservation, "logRegimeObservation");
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
__name(jsonResponse, "jsonResponse");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
