# One-request QR ZIP download

`GET {{LocalUrl}}/Engineering/AllEquipmentQRCodeDownload?OrganizationID=20&stream=true`

Send the usual Bearer token. This response uses newline-delimited JSON, not a raw
ZIP attachment. Without `stream=true`, the endpoint retains its direct ZIP response.

The same HTTP response contains these events in order:

1. `Type: Progress`: Status (Queued/Processing/CreatingZip), Percentage and counts.
2. `Type: FileStart`: ZIP FileName, FileSize (decoded bytes), MimeType; Percentage 90.
3. `Type: FileChunk`: Data containing one independently base64-encoded ZIP chunk;
   Percentage 90–99. Decode each chunk separately and concatenate the resulting bytes.
4. `Type: Completed`: Percentage 100, Status Completed or CompletedWithErrors and
   FailedQRCodes. Only then save the assembled ZIP. No DownloadURL is sent.

A `Type: Error` event or connection ending before Completed is a failure. Discard
partial ZIP data. Errors before streaming starts use normal HTTP error responses.
Network chunk boundaries are unrelated to JSON line boundaries.

## Frontend

Use `docs/examples/equipment-qr-stream.mjs` in the frontend:

```js
import { downloadEquipmentQRs } from './equipment-qr-stream.mjs';

try {
  const result = await downloadEquipmentQRs({
    localUrl: 'https://your-server.example/api',
    token: loginToken,
    organizationID: 20,
    onProgress: event => {
      setPercentage(event.Percentage ?? 0);
      setStatus(event.Status || 'Transferring');
    },
  });
  if (result.FailedQRCodes) alert(`${result.FailedQRCodes} equipment QR codes failed.`);
} catch (error) {
  alert(error.message);
}
```

This performs one fetch and automatically saves the ZIP via a local Blob URL;
the Blob URL does not make another server request. The browser stores the assembled
ZIP in memory. Base64 adds approximately 33% transfer overhead.

## Postman

Select GET, paste the URL with `stream=true`, and set Authorization → Bearer Token.
Click Send to inspect the NDJSON events (Postman may display them only after the
response finishes). Send and Download saves the mixed NDJSON, not a usable ZIP.
Use the frontend helper to decode/save a ZIP, or omit `stream=true` for Postman's
ordinary direct ZIP download without live progress.

The server reuses its local job worker internally; the client does not call job,
polling, or download endpoints. Disconnecting stops transmission; an already queued
job may finish and expire under the existing one-hour cleanup policy. Progress is
sampled, so small jobs may skip intermediate percentages. Proxies must allow long
streaming responses and disable buffering; the endpoint sends X-Accel-Buffering: no.
