const EngineeringService = require('../../services/EngineeringService/EngineeringService');
const fs = require('node:fs');
const { stat } = require('node:fs/promises');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createEquipmentQRCodeJobs } = require('../../services/EngineeringService/EquipmentQRCodeJobService');

const jobs = createEquipmentQRCodeJobs({
  generate: (...args) => EngineeringService.generateAllEquipmentQRCodes(...args),
});

function respondError(res, error) {
  if (res.headersSent) return res.destroy(error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : 'Unable to process equipment QR export.',
  });
}

exports.startEquipmentQRCodeJob = (req, res) => {
  try {
    const data = jobs.start({
      OrganizationID: req.body?.OrganizationID ?? req.query.OrganizationID,
      UserID: req.user?.UserID,
      UserType: req.user?.UserType,
      DepartmentName: req.user?.DepartmentName,
      LoginType: req.user?.LoginType,
      AllOrganizationAccess: req.user?.AllOrganizationAccess,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(202).json({ success: true, data });
  } catch (error) { return respondError(res, error); }
};

exports.getEquipmentQRCodeJob = (req, res) => {
  try {
    const data = jobs.status(req.params.JobID, req.user?.UserID);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: data.Status !== 'Failed', data });
  } catch (error) { return respondError(res, error); }
};

exports.downloadEquipmentQRCodeJob = (req, res) => {
  let download;
  try {
    download = jobs.acquireDownload(req.params.JobID, req.user?.UserID);
    res.setHeader('Cache-Control', 'no-store');
    res.download(download.filePath, download.fileName, error => {
      download.release();
      if (error) respondError(res, error);
    });
  } catch (error) {
    download?.release();
    return respondError(res, error);
  }
};

// One HTTP response: NDJSON progress followed by bounded base64 ZIP chunks.
exports.streamEquipmentQRCodes = async (req, res) => {
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  res.once('close', disconnect);
  let download;
  let file;
  const send = async event => {
    abort.signal.throwIfAborted();
    if (!res.write(JSON.stringify(event) + '\n')) {
      await once(res, 'drain', { signal: abort.signal });
    }
  };
  try {
    const started = jobs.start({
      ...req.user, OrganizationID: req.query.OrganizationID,
    });
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let previous;
    let lastSent = 0;
    let job;
    for (;;) {
      job = jobs.status(started.JobID, req.user?.UserID);
      const { DownloadURL, JobID, ExpiresAt, ...progress } = job;
      if (job.Status === 'Failed') {
        await send({ Type: 'Error', ...progress });
        res.end();
        return;
      }
      if (['Completed', 'CompletedWithErrors'].includes(job.Status)) break;
      const serialized = JSON.stringify(progress);
      if (serialized !== previous || Date.now() - lastSent >= 10000) {
        await send({ Type: 'Progress', ...progress });
        previous = serialized;
        lastSent = Date.now();
      }
      await delay(250, undefined, { signal: abort.signal });
    }
    download = jobs.acquireDownload(started.JobID, req.user?.UserID);
    const { size } = await stat(download.filePath);
    await send({ Type: 'FileStart', Status: 'Transferring', Percentage: 90,
      FileName: download.fileName, MimeType: 'application/zip', FileSize: size });
    file = fs.createReadStream(download.filePath, { highWaterMark: 64 * 1024 });
    let transferred = 0;
    for await (const chunk of file) {
      transferred += chunk.length;
      await send({ Type: 'FileChunk', Data: chunk.toString('base64'),
        Percentage: Math.min(99, 90 + Math.floor(transferred / size * 9)) });
    }
    await send({ Type: 'Completed', Status: job.Status, Percentage: 100,
      FileName: download.fileName, FileSize: size, TotalEquipment: job.TotalEquipment,
      TotalQRCodes: job.TotalQRCodes, FailedQRCodes: job.FailedQRCodes });
    res.end();
  } catch (error) {
    if (!abort.signal.aborted) {
      if (!res.headersSent) respondError(res, error);
      else {
        await send({ Type: 'Error', Status: 'Failed',
          Message: 'Unable to stream equipment QR ZIP. Please retry.' }).catch(() => {});
        res.end();
      }
    }
  } finally {
    file?.destroy();
    download?.release();
    res.off('close', disconnect);
  }
};
