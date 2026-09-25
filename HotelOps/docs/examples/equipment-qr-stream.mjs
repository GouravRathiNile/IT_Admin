// Import into the frontend. Exactly one fetch; no polling or download URL.
export async function readEquipmentQRStream(response, onProgress = () => {}) {
  if (!response.ok) throw new Error((await response.json()).message || 'QR export failed');
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    throw new Error('Expected QR stream. Add stream=true to the request.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', metadata, completed, received = 0;
  const chunks = [];
  function consume(line) {
    if (!line.trim()) return;
    if (completed) throw new Error('Unexpected data after completion');
    const event = JSON.parse(line);
    if (event.Type === 'Error') throw new Error(event.Message || 'QR export failed');
    if (event.Type === 'FileStart') {
      if (metadata || !Number.isSafeInteger(event.FileSize) || event.FileSize <= 0) {
        throw new Error('Invalid ZIP metadata');
      }
      metadata = event;
    } else if (event.Type === 'FileChunk') {
      if (!metadata) throw new Error('ZIP metadata missing');
      const binary = atob(event.Data);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      received += bytes.length;
      if (received > metadata.FileSize) throw new Error('Invalid ZIP length');
      chunks.push(bytes);
    } else if (event.Type === 'Completed') {
      if (!metadata || received !== metadata.FileSize || event.FileSize !== received) {
        throw new Error('Incomplete ZIP download');
      }
      completed = event;
    } else if (event.Type !== 'Progress') throw new Error('Unknown QR stream event');
    // Do not pass the large base64 payload to UI state.
    const { Data, ...progress } = event;
    onProgress(progress);
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (done) break;
    }
    if (pending.trim()) consume(pending);
    if (!completed) throw new Error('QR stream ended before ZIP completed');
    return { blob: new Blob(chunks, { type: 'application/zip' }),
      fileName: metadata.FileName, ...completed };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function downloadEquipmentQRs({ localUrl, token, organizationID, onProgress, signal }) {
  // localUrl example: https://your-server.example/api
  const url = `${localUrl.replace(/\/$/, '')}/Engineering/AllEquipmentQRCodeDownload?OrganizationID=${encodeURIComponent(organizationID)}&stream=true`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  const result = await readEquipmentQRStream(response, onProgress);
  const objectUrl = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = result.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  return result; // Check FailedQRCodes to display partial-success warning.
}
