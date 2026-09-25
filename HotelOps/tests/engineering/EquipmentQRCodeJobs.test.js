const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const express = require('express');
const { createEquipmentQRCodeJobs } = require('../../services/EngineeringService/EquipmentQRCodeJobService');

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for QR job');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const terminal = status => ['Completed', 'CompletedWithErrors', 'Failed'].includes(status);

test('job reports real progress, creates readable ZIP, scopes access and expires files', async t => {
  let clock = Date.now();
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const store = createEquipmentQRCodeJobs({ now: () => clock, ttlMs: 1000,
    generate: async (input, hooks) => {
      assert.equal(input.OrganizationID, 20);
      assert.equal(hooks.collect, false);
      hooks.onTotal(2);
      await hooks.onQRCode({ EquipmentID: 17, QRBuffer: Buffer.from('first PNG') });
      hooks.onProgress({ processed: 1, generated: 1, failed: 0 });
      await gate;
      await hooks.onQRCode({ EquipmentID: 18, QRBuffer: Buffer.from('second PNG') });
      hooks.onProgress({ processed: 2, generated: 2, failed: 0 });
      return { success: true };
    } });
  t.after(async () => { resume(); store.close(); clock += 10000; await store.cleanup(); });
  const started = store.start({ OrganizationID: '20', UserID: 7 });
  const id = started.JobID;
  assert.equal(started.Status, 'Queued');
  assert.equal(started.Percentage, 0);
  assert.equal(store.start({ OrganizationID: 20, UserID: 7 }).JobID, id);
  assert.throws(() => store.status(id, 8), { statusCode: 404 });
  assert.throws(() => store.acquireDownload(id, 8), { statusCode: 404 });
  assert.throws(() => store.acquireDownload(id, 7), { statusCode: 409 });
  await until(() => store.status(id, 7).Percentage === 45);
  assert.equal(store.status(id, 7).ProcessedEquipment, 1);
  assert.equal(store.status(id, 7).DownloadURL, undefined);
  resume();
  await until(() => terminal(store.status(id, 7).Status));
  const ready = store.status(id, 7);
  assert.equal(ready.Status, 'Completed');
  assert.equal(ready.Percentage, 100);
  assert.equal(ready.TotalQRCodes, 2);
  assert.ok(ready.DownloadURL.endsWith(`${id}/download`));
  const download = store.acquireDownload(id, 7);
  const zip = await JSZip.loadAsync(await fs.readFile(download.filePath));
  assert.deepEqual(Object.keys(zip.files).sort(), ['Equipment-17-QR.png', 'Equipment-18-QR.png']);
  assert.equal(await zip.file('Equipment-17-QR.png').async('string'), 'first PNG');
  clock += 1001;
  await store.cleanup();
  await fs.access(download.filePath); // Active download prevents deletion.
  download.release();
  download.release();
  await store.cleanup();
  await assert.rejects(fs.access(download.filePath), { code: 'ENOENT' });
  assert.throws(() => store.status(id, 7), { statusCode: 404 });
});

test('partial success is explicit; empty or failed exports never expose a download', async t => {
  let clock = Date.now();
  const store = createEquipmentQRCodeJobs({ now: () => clock, generate: async (input, hooks) => {
    hooks.onTotal(2);
    if (input.OrganizationID === 21) return { success: false, message: 'No equipment records found.' };
    if (input.OrganizationID === 22) throw new Error('database unavailable');
    await hooks.onQRCode({ EquipmentID: 17, QRBuffer: Buffer.from('PNG') });
    hooks.onProgress({ processed: 2, generated: 1, failed: 1 });
    return { success: true };
  } });
  t.after(async () => { store.close(); clock += 3600001; await store.cleanup(); });
  for (const OrganizationID of [20, 21, 22]) {
    const { JobID } = store.start({ OrganizationID, UserID: 7 });
    await until(() => terminal(store.status(JobID, 7).Status));
    const state = store.status(JobID, 7);
    if (OrganizationID === 20) {
      assert.equal(state.Status, 'CompletedWithErrors');
      assert.equal(state.FailedQRCodes, 1);
      assert.equal(state.Percentage, 100);
    } else {
      assert.equal(state.Status, 'Failed');
      assert.ok(state.Percentage < 100);
      assert.equal(state.DownloadURL, undefined);
      assert.throws(() => store.acquireDownload(JobID, 7), { statusCode: 409 });
    }
  }
});

test('queue rejects invalid requests and bounds simultaneous work', async t => {
  let clock = Date.now();
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const store = createEquipmentQRCodeJobs({ maxJobs: 2, now: () => clock, generate: async () => {
    await gate;
    return { success: false, message: 'No equipment' };
  } });
  t.after(async () => { resume(); store.close(); clock += 3600001; await store.cleanup(); });
  assert.throws(() => store.start({ OrganizationID: '', UserID: 7 }), { statusCode: 400 });
  assert.throws(() => store.start({ OrganizationID: 20 }), { statusCode: 401 });
  const a = store.start({ OrganizationID: 20, UserID: 7 });
  const b = store.start({ OrganizationID: 21, UserID: 7 });
  assert.throws(() => store.start({ OrganizationID: 22, UserID: 7 }), { statusCode: 429 });
  await until(() => store.status(a.JobID, 7).Status === 'Processing');
  assert.equal(store.status(b.JobID, 7).Status, 'Queued');
  resume();
  await until(() => [a, b].every(job => terminal(store.status(job.JobID, 7).Status)));
});

test('bulk generator callbacks count successes/failures and preserve the legacy buffer response', async () => {
  const source = await fs.readFile(path.join(__dirname,
    '../../services/EngineeringService/EngineeringService.js'), 'utf8');
  const start = source.indexOf('const generateAllEquipmentQRCodes =');
  const end = source.indexOf('// ============================================================================================Dashboard', start);
  const scope = { Buffer, console: { error() {} },
    pool: { query: async () => ({ rows: [1, 2, 3].map(equipmentid => ({ equipmentid })) }) },
    generateEquipmentQRCode: async ({ EquipmentID }) => EquipmentID === 2
      ? { success: false, message: 'Failed' }
      : { success: true, data: { QRCode: EquipmentID === 3 ? '' : 'data:image/png;base64,UE5H' } },
    ok: (message, data) => ({ success: true, message, data }),
    fail: (message, statusCode) => ({ success: false, message, statusCode }),
    retryableDatabaseResponse: () => null,
    databaseFailure: () => ({ success: false }),
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end) + '\nthis.generate = generateAllEquipmentQRCodes;', scope);
  const progress = [];
  const buffers = [];
  const result = await scope.generate({ OrganizationID: 20 }, { collect: false,
    onTotal: total => assert.equal(total, 3),
    onQRCode: qr => buffers.push(qr), onProgress: state => progress.push({ ...state }),
  });
  assert.equal(result.success, true);
  assert.equal(result.data.QRCodes.length, 0);
  assert.equal(buffers.length, 1);
  assert.deepEqual(progress, [
    { processed: 1, generated: 1, failed: 0 },
    { processed: 2, generated: 1, failed: 1 },
    { processed: 3, generated: 1, failed: 2 },
  ]);
  const legacy = await scope.generate({ OrganizationID: 20 });
  assert.equal(legacy.data.QRCodes.length, 1);
  assert.equal(legacy.data.QRCodes[0].QRBuffer.toString(), 'PNG');
  const streamFailure = await scope.generate({ OrganizationID: 20 }, {
    onQRCode: () => { throw new Error('Disk full'); },
  });
  assert.equal(streamFailure.success, false);
});

test('HTTP start, poll and authorized download return the documented contract', async t => {
  let store;
  let clock = Date.now();
  const scope = { exports: {}, AbortController, require(name) {
    if (name.startsWith('node:')) return require(name);
    if (name.endsWith('/EngineeringService')) return { generateAllEquipmentQRCodes: async (input, hooks) => {
      hooks.onTotal(1);
      await hooks.onQRCode({ EquipmentID: 17, QRBuffer: Buffer.from('PNG') });
      hooks.onProgress({ processed: 1, generated: 1, failed: 0 });
      return { success: true };
    } };
    if (name.endsWith('/EquipmentQRCodeJobService')) return {
      createEquipmentQRCodeJobs(options) {
        store = createEquipmentQRCodeJobs({ ...options, now: () => clock });
        return store;
      },
    };
    throw new Error(name);
  } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname,
    '../../controllers/EngineeringController/EquipmentQRCodeJobController.js'), 'utf8'), scope);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { UserID: req.headers['x-test-user'] || 7 }; next(); });
  app.post('/jobs', scope.exports.startEquipmentQRCodeJob);
  app.get('/jobs/:JobID', scope.exports.getEquipmentQRCodeJob);
  app.get('/jobs/:JobID/download', scope.exports.downloadEquipmentQRCodeJob);
  app.get('/stream', scope.exports.streamEquipmentQRCodes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    store.close(); clock += 3600001; await store.cleanup();
  });
  const base = `http://127.0.0.1:${server.address().port}/jobs`;
  const startResponse = await fetch(base, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ OrganizationID: 20 }) });
  assert.equal(startResponse.status, 202);
  const { data: job } = await startResponse.json();
  await until(() => terminal(store.status(job.JobID, 7).Status));
  const polled = await fetch(`${base}/${job.JobID}`);
  assert.equal(polled.headers.get('cache-control'), 'no-store');
  assert.equal((await polled.json()).data.Percentage, 100);
  const denied = await fetch(`${base}/${job.JobID}/download`, { headers: { 'x-test-user': '8' } });
  assert.equal(denied.status, 404);
  const download = await fetch(`${base}/${job.JobID}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /application\/zip/);
  assert.match(download.headers.get('content-disposition'), /Equipment-QR-Organization-20.zip/);
  const zip = await JSZip.loadAsync(await download.arrayBuffer());
  assert.equal(await zip.file('Equipment-17-QR.png').async('string'), 'PNG');
  const { readEquipmentQRStream } = await import('../../docs/examples/equipment-qr-stream.mjs');
  const events = [];
  const streamed = await fetch(base.replace('/jobs', '/stream') + '?OrganizationID=20');
  const result = await readEquipmentQRStream(streamed, event => events.push(event));
  const streamZip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(await streamZip.file('Equipment-17-QR.png').async('string'), 'PNG');
  assert.equal(events.at(-1).Percentage, 100);
  assert.equal(events.at(-1).Type, 'Completed');
  assert.ok(events.every(event => !('DownloadURL' in event)));
  assert.ok(events.some(event => event.Type === 'Progress'));
  const routes = await fs.readFile(path.join(__dirname,
    '../../routes/EngineeringRoutes/EngineeringRoutes.js'), 'utf8');
  for (const route of ['/EquipmentQRCodeJobs', '/EquipmentQRCodeJobs/:JobID', '/EquipmentQRCodeJobs/:JobID/download']) {
    assert.ok(routes.includes(`"${route}", authenticateToken,`));
  }
});

test('frontend stream reader rejects truncation and handles split JSON lines', async () => {
  const { readEquipmentQRStream } = await import('../../docs/examples/equipment-qr-stream.mjs');
  const lines = [
    { Type: 'FileStart', FileName: 'test.zip', FileSize: 3 },
    { Type: 'FileChunk', Data: 'UE5H', Percentage: 99 },
    { Type: 'Completed', FileSize: 3, Percentage: 100 },
  ].map(event => JSON.stringify(event) + '\n');
  const response = text => new Response(new ReadableStream({ start(controller) {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  const result = await readEquipmentQRStream(response(lines.join('')));
  assert.equal(await result.blob.text(), 'PNG');
  await assert.rejects(readEquipmentQRStream(response(lines.slice(0, 2).join(''))), /before ZIP completed/);
  await assert.rejects(readEquipmentQRStream(response(lines[0] + lines[2])), /Incomplete ZIP/);
  await assert.rejects(readEquipmentQRStream(response('{"Type":"Error","Message":"Failed"}\n')), /Failed/);
});
