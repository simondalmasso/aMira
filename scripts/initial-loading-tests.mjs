import assert from 'node:assert/strict';

let passed = 0;
async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// This is the small behavioral model of MainDashboard's /api/macro lifecycle.
// It deliberately exercises the user-visible state transitions and stale-response
// guard without relying on a browser or a component-test framework.
class MacroRequestModel {
  latestRequest = 0;
  status = 'loading';
  label = 'ERROR';

  warningVisible() {
    return this.status === 'error' && this.label === 'ERROR';
  }

  lastFetchText(lastSync = null) {
    if (lastSync) return lastSync;
    if (this.status === 'loading') return 'esperando datos';
    if (this.status === 'syncing') return 'sincronizando';
    return '--:--:--';
  }

  async load(fetchImpl, manual = false, timeoutMs = 0) {
    const requestId = ++this.latestRequest;
    this.status = manual ? 'syncing' : 'loading';
    try {
      const response = await (timeoutMs > 0
        ? Promise.race([
            fetchImpl(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('macro request timed out')), timeoutMs)),
          ])
        : fetchImpl());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (requestId !== this.latestRequest) return;
      if (!data?.success) throw new Error('Macro API returned success:false');
      this.label = ['REAL', 'STALE', 'OBSERVADO', 'PARTIAL_FALLBACK', 'SIMULADO', 'RECONSTRUIDO'].includes(data.source)
        ? data.source
        : 'PARTIAL_FALLBACK';
      this.status = 'success';
    } catch (error) {
      if (requestId !== this.latestRequest) return;
      this.label = 'ERROR';
      this.status = 'error';
    }
  }
}

const ok = (data) => ({ ok: true, status: 200, json: async () => data });

await test('first render is CARGANDO, never ERROR', () => {
  const model = new MacroRequestModel();
  assert.equal(model.status, 'loading');
  assert.notEqual(model.status, 'error');
  assert.equal(model.lastFetchText(), 'esperando datos');
  assert.equal(model.warningVisible(), false);
});

await test('HTTP 200 + success:true exposes the backend badge', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ok({ success: true, source: 'REAL' }));
  assert.equal(model.status, 'success');
  assert.equal(model.label, 'REAL');
  assert.equal(model.warningVisible(), false);
});

await test('a successful fallback remains a fallback, not ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ok({ success: true, source: 'PARTIAL_FALLBACK' }));
  assert.equal(model.status, 'success');
  assert.equal(model.label, 'PARTIAL_FALLBACK');
});

await test('HTTP 500 becomes ERROR even when JSON says success', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ({ ok: false, status: 500, json: async () => ({ success: true }) }));
  assert.equal(model.status, 'error');
  assert.equal(model.label, 'ERROR');
  assert.equal(model.warningVisible(), true);
});

await test('HTTP 401 becomes ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal(model.status, 'error');
  assert.equal(model.label, 'ERROR');
});

await test('HTTP 429 becomes ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  assert.equal(model.status, 'error');
});

await test('invalid JSON becomes ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON'); } }));
  assert.equal(model.status, 'error');
  assert.equal(model.label, 'ERROR');
});

await test('success:false becomes ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ok({ success: false, source: 'REAL' }));
  assert.equal(model.status, 'error');
  assert.equal(model.label, 'ERROR');
});

await test('network rejection becomes ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => { throw new TypeError('network down'); });
  assert.equal(model.status, 'error');
  assert.equal(model.warningVisible(), true);
});

await test('a real timeout becomes ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(() => new Promise(() => {}), false, 1);
  assert.equal(model.status, 'error');
  assert.equal(model.label, 'ERROR');
});

await test('manual refresh is SINCRONIZANDO while pending', async () => {
  const model = new MacroRequestModel();
  const request = deferred();
  const pending = model.load(() => request.promise, true);
  assert.equal(model.status, 'syncing');
  assert.equal(model.lastFetchText(), 'sincronizando');
  assert.equal(model.warningVisible(), false);
  request.resolve(ok({ success: true, source: 'STALE' }));
  await pending;
  assert.equal(model.status, 'success');
  assert.equal(model.label, 'STALE');
});

await test('a late successful request cannot overwrite a newer success', async () => {
  const model = new MacroRequestModel();
  const oldRequest = deferred();
  const newRequest = deferred();
  const oldPending = model.load(() => oldRequest.promise);
  const newPending = model.load(() => newRequest.promise, true);
  newRequest.resolve(ok({ success: true, source: 'REAL' }));
  await newPending;
  oldRequest.resolve(ok({ success: true, source: 'STALE' }));
  await oldPending;
  assert.equal(model.status, 'success');
  assert.equal(model.label, 'REAL');
});

await test('a late failed request cannot overwrite a newer success', async () => {
  const model = new MacroRequestModel();
  const oldRequest = deferred();
  const newRequest = deferred();
  const oldPending = model.load(() => oldRequest.promise);
  const newPending = model.load(() => newRequest.promise, true);
  newRequest.resolve(ok({ success: true, source: 'OBSERVADO' }));
  await newPending;
  oldRequest.reject(new TypeError('old network failure'));
  await oldPending;
  assert.equal(model.status, 'success');
  assert.equal(model.label, 'OBSERVADO');
  assert.equal(model.warningVisible(), false);
});

await test('unknown success provenance never turns into ERROR', async () => {
  const model = new MacroRequestModel();
  await model.load(async () => ok({ success: true, source: 'UNKNOWN' }));
  assert.equal(model.status, 'success');
  assert.equal(model.label, 'PARTIAL_FALLBACK');
});

console.log(`\n${passed} behavioral tests passed`);
