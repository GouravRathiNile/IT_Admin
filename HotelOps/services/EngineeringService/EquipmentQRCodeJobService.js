const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');

const errorWithStatus = (message, statusCode) => Object.assign(new Error(message), { statusCode });

// Process-local queue. A single worker bounds QR rendering/compression pressure.
// Multi-instance deployments must use a shared job store/worker or sticky routing.
function createEquipmentQRCodeJobs({ generate, ttlMs = 60 * 60 * 1000,
  maxJobs = 50, now = Date.now, tempRoot = os.tmpdir() }) {
  const jobs = new Map();
  const queue = [];
  let running = false;

  function snapshot(job) {
    const ready = ['Completed', 'CompletedWithErrors'].includes(job.Status);
    return {
      JobID: job.JobID, OrganizationID: job.OrganizationID,
      Status: job.Status, Percentage: job.Percentage,
      TotalEquipment: job.TotalEquipment, ProcessedEquipment: job.ProcessedEquipment,
      TotalQRCodes: job.TotalQRCodes, FailedQRCodes: job.FailedQRCodes,
      Message: job.Message,
      ExpiresAt: job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
      ...(ready ? { DownloadURL: `/api/Engineering/EquipmentQRCodeJobs/${job.JobID}/download` } : {}),
    };
  }

  function owned(id, userID) {
    const job = jobs.get(id);
    if (!job || job.owner !== String(userID) || (job.expiresAt && job.expiresAt <= now())) {
      throw errorWithStatus('QR job not found or expired.', 404);
    }
    return job;
  }

  async function cleanup() {
    for (const [id, job] of jobs) {
      if (job.expiresAt && job.expiresAt <= now() && !job.downloads) {
        // Delete only this job's internally created temporary directory.
        if (job.directory) await fsp.rm(job.directory, { recursive: true, force: true });
        jobs.delete(id);
      }
    }
  }
  const timer = setInterval(() => cleanup().catch(error =>
    console.error('Equipment QR cleanup failed:', error.message)), 60_000);
  timer.unref();

  async function execute(job) {
    let archive;
    let completion;
    try {
      job.Status = 'Processing';
      job.Message = 'Generating equipment QR codes.';
      job.directory = await fsp.mkdtemp(path.join(tempRoot, 'hotelops-equipment-qr-'));
      job.filePath = path.join(job.directory, 'equipment.zip');
      const { ZipArchive } = await import('archiver');
      archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('warning', error => archive.destroy(error));
      completion = pipeline(archive, fs.createWriteStream(job.filePath, { flags: 'wx' }));
      // Observe early disk/stream errors even while a QR is being rendered.
      completion.catch(() => {});
      const streamEnded = completion.then(() => { throw new Error('ZIP closed before generation finished.'); });
      streamEnded.catch(() => {});

      const result = await generate(job.input, {
        collect: false,
        onTotal(total) { job.TotalEquipment = total; },
        async onQRCode(qr) {
          const written = once(archive, 'entry');
          archive.append(qr.QRBuffer, { name: `Equipment-${qr.EquipmentID}-QR.png` });
          // Wait for each entry: do not retain every QR buffer for a large export.
          await Promise.race([written, streamEnded]);
        },
        onProgress({ processed, generated, failed }) {
          job.ProcessedEquipment = processed;
          job.TotalQRCodes = generated;
          job.FailedQRCodes = failed;
          job.Percentage = job.TotalEquipment ? Math.floor(processed / job.TotalEquipment * 90) : 0;
        },
      });
      if (!result.success) throw new Error(result.message || 'QR generation failed.');
      job.Status = 'CreatingZip';
      job.Message = 'Finalizing ZIP file.';
      job.Percentage = 90;
      await archive.finalize();
      await completion;
      job.Status = job.FailedQRCodes ? 'CompletedWithErrors' : 'Completed';
      job.Message = job.FailedQRCodes
        ? 'ZIP ready, but some equipment QR codes could not be generated.'
        : 'Equipment QR ZIP is ready to download.';
      job.Percentage = 100;
    } catch (error) {
      archive?.destroy(error);
      if (completion) await completion.catch(() => {});
      job.Status = 'Failed';
      job.Message = 'Unable to generate equipment QR ZIP. Please retry.';
      console.error(`Equipment QR job ${job.JobID} failed:`, error.message);
      if (job.directory) {
        await fsp.rm(job.directory, { recursive: true, force: true }).catch(() => {});
      }
    } finally {
      job.expiresAt = now() + ttlMs;
      delete job.input;
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) await execute(queue.shift());
    } finally { running = false; }
  }

  return {
    start(input) {
      const OrganizationID = Number(input.OrganizationID);
      if (!Number.isSafeInteger(OrganizationID) || OrganizationID <= 0) {
        throw errorWithStatus('Valid OrganizationID is required.', 400);
      }
      if (!input.UserID) throw errorWithStatus('Authentication is required.', 401);
      // Repeated clicks/polling must not enqueue duplicate active exports.
      for (const job of jobs.values()) {
        if (job.owner === String(input.UserID) && job.OrganizationID === OrganizationID && !job.expiresAt) {
          return snapshot(job);
        }
      }
      if (jobs.size >= maxJobs) throw errorWithStatus('QR export queue is full. Please try again later.', 429);
      const job = {
        JobID: randomUUID(), owner: String(input.UserID), OrganizationID,
        Status: 'Queued', Percentage: 0, TotalEquipment: 0, ProcessedEquipment: 0,
        TotalQRCodes: 0, FailedQRCodes: 0, Message: 'QR export queued.',
        downloads: 0, input: { ...input, OrganizationID },
      };
      jobs.set(job.JobID, job);
      queue.push(job);
      setImmediate(() => drain().catch(error => console.error('QR worker failed:', error.message)));
      return snapshot(job);
    },
    status(id, userID) { return snapshot(owned(id, userID)); },
    acquireDownload(id, userID) {
      const job = owned(id, userID);
      if (!['Completed', 'CompletedWithErrors'].includes(job.Status)) {
        throw errorWithStatus('QR ZIP is not ready to download.', 409);
      }
      job.downloads++;
      let released = false;
      return {
        filePath: job.filePath,
        fileName: `Equipment-QR-Organization-${job.OrganizationID}.zip`,
        release() { if (!released) { released = true; job.downloads--; } },
      };
    },
    cleanup,
    // Stop the cleanup timer when disposing the store (also used by tests).
    close() { clearInterval(timer); },
  };
}

module.exports = { createEquipmentQRCodeJobs };
