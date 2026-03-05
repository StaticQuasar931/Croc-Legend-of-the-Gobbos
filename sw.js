// Croc: Legend of the Gobbos (PS1) - Service Worker
// Virtualizes track01.bin from split parts track01.bin.001 ... track01.bin.011

const PARTS = [
  "track01.bin.001",
  "track01.bin.002",
  "track01.bin.003",
  "track01.bin.004",
  "track01.bin.005",
  "track01.bin.006",
  "track01.bin.007",
  "track01.bin.008",
  "track01.bin.009",
  "track01.bin.010",
  "track01.bin.011",
];

let partSizes = null;
let totalSize = null;

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function ensureSizes(baseUrl) {
  if (partSizes && totalSize != null) return;

  partSizes = [];
  totalSize = 0;

  for (const p of PARTS) {
    const res = await fetch(new URL(p, baseUrl).toString(), { method: "HEAD" });
    if (!res.ok) throw new Error(`Missing part: ${p} (${res.status})`);
    const len = Number(res.headers.get("content-length") || "0");
    if (!len) throw new Error(`No content-length for: ${p}`);
    partSizes.push(len);
    totalSize += len;
  }
}

function parseRange(rangeHeader, size) {
  // Only supports a single range: bytes=start-end
  if (!rangeHeader) return null;
  const m = rangeHeader.match(/bytes=(\d*)-(\d*)/i);
  if (!m) return null;

  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);

  // bytes=-500 (last 500 bytes)
  if (start === null && end !== null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    if (start === null) start = 0;
    if (end === null || end >= size) end = size - 1;
  }

  if (start > end || start < 0 || end < 0) return null;
  return { start, end };
}

async function fetchRangeFromParts(baseUrl, start, end) {
  // Build list of (partIndex, partStart, partEnd)
  let offset = 0;
  const slices = [];

  for (let i = 0; i < PARTS.length; i++) {
    const sz = partSizes[i];
    const partStartGlobal = offset;
    const partEndGlobal = offset + sz - 1;

    if (end < partStartGlobal) break;
    if (start > partEndGlobal) {
      offset += sz;
      continue;
    }

    const s = Math.max(0, start - partStartGlobal);
    const e = Math.min(sz - 1, end - partStartGlobal);
    slices.push({ i, s, e });
    offset += sz;
  }

  const chunks = [];
  for (const sl of slices) {
    const url = new URL(PARTS[sl.i], baseUrl).toString();
    const res = await fetch(url, {
      headers: { Range: `bytes=${sl.s}-${sl.e}` },
    });
    if (!(res.status === 206 || res.status === 200)) {
      throw new Error(`Range fetch failed: ${PARTS[sl.i]} (${res.status})`);
    }
    chunks.push(await res.arrayBuffer());
  }

  return new Blob(chunks, { type: "application/octet-stream" });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only virtualize requests to track01.bin in this folder
  if (!url.pathname.endsWith("/track01.bin")) return;

  event.respondWith((async () => {
    const baseUrl = url.origin + url.pathname.replace(/track01\.bin$/, "");
    await ensureSizes(baseUrl);

    const range = parseRange(event.request.headers.get("Range"), totalSize);

    // HEAD support
    if (event.request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(totalSize),
          "Content-Type": "application/octet-stream",
        },
      });
    }

    // Full file (rare)
    if (!range) {
      const blob = await fetchRangeFromParts(baseUrl, 0, totalSize - 1);
      return new Response(blob, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(totalSize),
          "Content-Type": "application/octet-stream",
        },
      });
    }

    const { start, end } = range;
    const blob = await fetchRangeFromParts(baseUrl, start, end);
    const len = end - start + 1;

    return new Response(blob, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": String(len),
        "Content-Type": "application/octet-stream",
      },
    });
  })());
});