# Equipment QR ZIP progress

The existing `GET /api/Engineering/AllEquipmentQRCodeDownload?OrganizationID=20`
still downloads directly. Use these job endpoints to show progress instead.
All requests require `Authorization: Bearer <token>`. Only the job creator can
inspect or download it. No database migration or new npm dependency is required.

## Start

`POST /api/Engineering/EquipmentQRCodeJobs`

```json
{ "OrganizationID": 20 }
```

HTTP 202 returns:

```json
{
  "success": true,
  "data": {
    "JobID": "<job-id>",
    "OrganizationID": 20,
    "Status": "Queued",
    "Percentage": 0,
    "TotalEquipment": 0,
    "ProcessedEquipment": 0,
    "TotalQRCodes": 0,
    "FailedQRCodes": 0,
    "Message": "QR export queued.",
    "ExpiresAt": null
  }
}
```

Repeated starts for the same user and organization reuse an active job.

## Poll every 1–2 seconds

`GET /api/Engineering/EquipmentQRCodeJobs/<job-id>`

The same data shape is returned. Percentage is based on processed equipment:
`floor(ProcessedEquipment / TotalEquipment * 90)`. Small jobs may finish between
polls; accept skipped percentages rather than expect exactly 10, 20, etc.

| Status | Frontend behavior |
| --- | --- |
| Queued | Wait for the worker. |
| Processing | Show Percentage and counts. |
| CreatingZip | Show 90% and Finalizing ZIP. |
| Completed | Show 100%, stop polling and download ZIP. |
| CompletedWithErrors | Show 100%, stop polling, show FailedQRCodes and offer partial ZIP. |
| Failed | Stop polling and show Message; there is no download. |

Polling returns `success: false` for Failed. HTTP 404 means unknown, expired, or
another user's job. Stop polling on terminal states or HTTP errors.
Only a fully written ZIP exposes `DownloadURL` and `ExpiresAt`.

## Download

`GET /api/Engineering/EquipmentQRCodeJobs/<job-id>/download`

Returns a ZIP attachment. Before completion returns HTTP 409.
`DownloadURL` is API-origin-relative, for example:
`/api/Engineering/EquipmentQRCodeJobs/<job-id>/download`.

Fetch with the bearer token; a plain anchor does not send it. Frontend example
(apiOrigin is the backend origin without `/api`):

```js
async function exportQRs(apiOrigin, token, organizationID, onProgress, signal) {
  const headers = { Authorization: `Bearer ${token}` };
  async function request(url, options = {}) {
    const response = await fetch(new URL(url, apiOrigin), {
      ...options, signal, headers: { ...headers, ...options.headers },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'QR request failed');
    return body.data;
  }
  let job = await request('/api/Engineering/EquipmentQRCodeJobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ OrganizationID: organizationID }),
  });
  for (;;) {
    onProgress(job);
    if (job.Status === 'Failed') throw new Error(job.Message);
    if (['Completed', 'CompletedWithErrors'].includes(job.Status)) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
    job = await request(`/api/Engineering/EquipmentQRCodeJobs/${job.JobID}`);
  }
  // Show FailedQRCodes in onProgress for CompletedWithErrors.
  const response = await fetch(new URL(job.DownloadURL, apiOrigin), { headers, signal });
  if (!response.ok) throw new Error('ZIP download failed');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `Equipment-QR-Organization-${organizationID}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
```

100% means the ZIP is ready, not that transfer to the user's device finished.
Closing the page stops polling but does not cancel the background job.

## Deployment and retention

- Process-local queue: one active export, at most 50 retained jobs. Full queue: HTTP 429.
- Job metadata and ZIPs expire one hour after completion/failure. Cleanup runs every
  minute and protects downloads in progress.
- Restarting Node loses the registry; start a new export after restart. Temporary
  files left by an abrupt shutdown rely on the host's temporary-file cleanup.
- Use a single Node process or route start/status/download to the same instance.
  Durable jobs or multiple interchangeable workers require shared queue/state and ZIP storage.
