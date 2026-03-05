// sw.js
// Adds proper Range support for the stitched Track 01 virtual file.

const CACHE_NAME = "croc-track01-cache-v2";

const TRACK01_VIRTUAL = "Croc - Legend of the Gobbos (Europe) (Track 01).bin";

const TRACK01_PARTS = [
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.001",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.002",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.003",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.004",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.005",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.006",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.007",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.008",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.009",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.010",
  "Croc - Legend of the Gobbos (Europe) (Track 01).bin.011"
];

let sizesReady = false;
let partSizes = [];
let partOffsets = [];
let totalSize = 0;

function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const name = u.pathname.split("/").pop();
    return decodeURIComponent(name || "");
  } catch {
    return "";
  }
}

async function headSize(url) {
  const r = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!r.ok) throw new Error(`HEAD failed: ${url} (${r.status})`);
  const len = r.headers.get("Content-Length");
  if (!len) throw new Error(`No Content-Length for: ${url}`);
  return Number(len);
}

async function ensureSizes() {
  if (sizesReady) return;

  partSizes = [];
  partOffsets = [];
  totalSize = 0;

  for (const part of TRACK01_PARTS) {
    const sz = await headSize(part);
    partOffsets.push(totalSize);
    partSizes.push(sz);
    totalSize += sz;
  }

  sizesReady = true;
}

function parseRange(rangeHeader, size) {
  // Supports: bytes=start-end OR bytes=start- OR bytes=-suffix
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || "");
  if (!m) return null;

  let startStr = m[1];
  let endStr = m[2];

  let start;
  let end;

  if (startStr === "" && endStr === "") return null;

  if (startStr === "") {
    // suffix length
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    if (!Number.isFinite(start) || start < 0) return null;

    if (endStr === "") {
      end = size - 1;
    } else {
      end = Number(endStr);
      if (!Number.isFinite(end) || end < start) return null;
      end = Math.min(end, size - 1);
    }
  }

  if (start >= size) return null;
  return { start, end };
}

async function fromCacheOrNet(url) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url);
  if (hit) return hit;
  return fetch(url, { cache: "no-store" });
}

async function streamFullTrack01() {
  return new ReadableStream({
    async start(controller) {
      try {
        for (const part of TRACK01_PARTS) {
          const resp = await fromCacheOrNet(part);
          if (!resp.ok) throw new Error("Missing part: " + part);

          if (!resp.body) {
            controller.enqueue(new Uint8Array(await resp.arrayBuffer()));
            continue;
          }

          const reader = resp.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });
}

async function streamRangeTrack01(start, end) {
  // Streams only the bytes requested, by mapping to part ranges.
  await ensureSizes();

  const length = end - start + 1;

  return new ReadableStream({
    async start(controller) {
      try {
        let remainingStart = start;
        let remainingEnd = end;

        for (let i = 0; i < TRACK01_PARTS.length; i++) {
          const partStartAbs = partOffsets[i];
          const partEndAbs = partOffsets[i] + partSizes[i] - 1;

          if (remainingEnd < partStartAbs) break;
          if (remainingStart > partEndAbs) continue;

          const inPartStart = Math.max(0, remainingStart - partStartAbs);
          const inPartEnd = Math.min(partSizes[i] - 1, remainingEnd - partStartAbs);

          // Fetch exact bytes from that part using Range
          const headers = new Headers();
          headers.set("Range", `bytes=${inPartStart}-${inPartEnd}`);

          // Try cache first. If cache response exists, we still need slicing.
          // Easiest reliable way: do a network Range request (GitHub supports Range).
          // If network fails, fall back to cached full + slice in memory.
          let resp;
          try {
            resp = await fetch(TRACK01_PARTS[i], { headers, cache: "no-store" });
          } catch {
            resp = null;
          }

          if (!resp || !resp.ok) {
            const cached = await fromCacheOrNet(TRACK01_PARTS[i]);
            if (!cached.ok) throw new Error("Missing part: " + TRACK01_PARTS[i]);
            const buf = await cached.arrayBuffer();
            const slice = buf.slice(inPartStart, inPartEnd + 1);
            controller.enqueue(new Uint8Array(slice));
          } else {
            if (!resp.body) {
              controller.enqueue(new Uint8Array(await resp.arrayBuffer()));
            } else {
              const reader = resp.body.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            }
          }

          // Continue to next part if needed
        }

        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const name = fileNameFromUrl(event.request.url);
  if (name !== TRACK01_VIRTUAL) return;

  event.respondWith((async () => {
    const rangeHeader = event.request.headers.get("Range");

    // If Range requested, respond 206 with proper headers
    if (rangeHeader) {
      await ensureSizes();
      const r = parseRange(rangeHeader, totalSize);
      if (!r) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
            "Accept-Ranges": "bytes"
          }
        });
      }

      const stream = await streamRangeTrack01(r.start, r.end);
      const contentLength = (r.end - r.start + 1);

      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${r.start}-${r.end}/${totalSize}`,
          "Content-Length": String(contentLength),
          "Cache-Control": "no-store"
        }
      });
    }

    // No Range: stream full file
    let stream;
    try {
      await ensureSizes();
      stream = await streamFullTrack01();
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Length": String(totalSize),
          "Cache-Control": "no-store"
        }
      });
    } catch (e) {
      // Still try without size calc if HEAD fails
      stream = await streamFullTrack01();
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        }
      });
    }
  })());
});