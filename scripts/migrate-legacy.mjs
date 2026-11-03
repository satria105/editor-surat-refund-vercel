import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { get, list, put } from '@vercel/blob';

const ORIGIN = 'https://refundm.aiorbitlab.me';
const stable = (x) => JSON.stringify(sortKeys(x));
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])]));
  return x;
}
const digest = x => createHash('sha256').update(x).digest('hex');
const order = (a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
async function mapLimit(items, fn, limit = 4) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(limit, items.length)}, async () => {
    while (next < items.length) { const n = next++; out[n] = await fn(items[n], n); }
  }));
  return out;
}
async function source(path) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) throw new Error('Invalid source origin');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect:'error', signal:AbortSignal.timeout(45000), cache:'no-store' });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      return response;
    } catch (error) { if (attempt === 2) throw error; }
  }
}
async function blobBytes(path) {
  const result = await get(path, { access:'private', useCache:false });
  if (!result || result.statusCode !== 200) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (process.env.VERCEL) throw new Error('Destination private Blob is not configured');
    console.log('Legacy import skipped outside configured Vercel build.'); return;
  }
  const config = JSON.parse(await readFile(new URL('./legacy-migration-config.json', import.meta.url), 'utf8'));
  const summaries = new Map();
  const batches = await mapLimit(config.queries, async query => {
    const path = '/api/history' + (query ? '?q=' + encodeURIComponent(query) : '');
    const result = await (await source(path)).json();
    if (!Array.isArray(result.items)) throw new Error('Invalid source history list');
    return result.items;
  });
  for (const batch of batches) for (const item of batch) summaries.set(item.id, item);
  const originals = await mapLimit([...summaries.values()], async summary => {
    const detail = await (await source('/api/history/' + encodeURIComponent(summary.id))).json();
    if (detail.id !== summary.id || !detail.data || typeof detail.data !== 'object' ||
        typeof summary.createdAt !== 'string' || typeof summary.updatedAt !== 'string') throw new Error('Incomplete source record');
    return { id:summary.id, data:detail.data, createdAt:summary.createdAt, updatedAt:summary.updatedAt };
  });
  originals.sort(order);
  const sourceHash = digest(stable(originals));
  if (originals.length !== config.expectedCount || sourceHash !== config.expectedSourceHash) {
    throw new Error('Source snapshot changed; stopped before writes to avoid a partial or stale migration');
  }
  console.log(`Legacy source verified: ${originals.length} records, SHA256 ${sourceHash}`);
  const photos = new Map();
  const uploads = new Map();
  let photoReferences = 0, inserted = 0, retained = 0;
  const converted = await mapLimit(originals, async record => {
    const refs = record.data.proofImages ?? [];
    if (!Array.isArray(refs)) throw new Error('Invalid source proof list');
    const targetRefs = [];
    for (const ref of refs) {
      photoReferences++;
      if (typeof ref !== 'string') throw new Error('Invalid source proof reference');
      if (!photos.has(ref)) photos.set(ref, (async () => {
        let bytes, contentType;
        if (ref.startsWith('data:image/')) {
          const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(ref);
          if (!match) throw new Error('Invalid embedded proof image');
          contentType = match[1]; bytes = Buffer.from(match[2], 'base64');
        } else {
          const url = new URL(ref, ORIGIN);
          if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/proof/')) throw new Error('Proof outside allowed source');
          const response = await source(url.pathname + url.search);
          contentType = (response.headers.get('content-type') ?? '').split(';')[0];
          bytes = Buffer.from(await response.arrayBuffer());
        }
        if (!bytes.length || !contentType.startsWith('image/')) throw new Error('Source proof is missing or not an image');
        const hash = digest(bytes);
        const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'})[contentType] ?? 'img';
        const pathname = `proof_migrated_${hash}.${ext}`;
        if (!uploads.has(pathname)) uploads.set(pathname, (async () => {
          const existing = await blobBytes(pathname);
          if (existing) {
            if (digest(existing) !== hash) throw new Error('Destination proof conflict');
          } else {
            await put(pathname, bytes, {access:'private',contentType,addRandomSuffix:false,allowOverwrite:false});
          }
          const verified = await blobBytes(pathname);
          if (!verified || digest(verified) !== hash) throw new Error('Destination proof verification failed');
        })());
        await uploads.get(pathname);
        return { pathname, hash, size:bytes.length };
      })());
      const photo = await photos.get(ref);
      targetRefs.push('/api/proof/' + encodeURIComponent(photo.pathname));
    }
    const target = {...record, data:{...record.data, proofImages:targetRefs}};
    const pathname = `history/${Buffer.from(record.id,'utf8').toString('base64url')}.json`;
    const existing = await blobBytes(pathname);
    if (existing) {
      if (stable(JSON.parse(existing.toString('utf8'))) !== stable(target)) throw new Error('Existing destination record differs; no overwrite performed');
      retained++;
    } else {
      await put(pathname, stable(target), {access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});
      inserted++;
    }
    const checked = await blobBytes(pathname);
    if (!checked || stable(JSON.parse(checked.toString('utf8'))) !== stable(target)) throw new Error('Destination record verification failed');
    return target;
  });
  converted.sort(order);
  const photoSnapshot = await Promise.all([...photos].map(async ([reference, promise]) => {
    const value = await promise;
    return {reference, hash:value.hash, size:value.size};
  }));
  photoSnapshot.sort((a,b) => a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0);
  if (digest(stable(photoSnapshot)) !== config.expectedPhotoHash) throw new Error('Source image bytes changed from verified backup');
  const uniquePhotos = new Map((await Promise.all([...photos.values()])).map(x => [x.pathname,x]));
  const photoBytes = [...uniquePhotos.values()].reduce((a,x)=>a+x.size,0);
  if (photoReferences !== config.expectedPhotoReferences || uniquePhotos.size !== config.expectedUniquePhotos || photoBytes !== config.expectedPhotoBytes) throw new Error('Photo migration totals differ from backup');
  let cursor, storedCount = 0;
  do { const page = await list({prefix:'history/',limit:1000,...(cursor ? {cursor} : {})}); storedCount += page.blobs.length; cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  console.log('LEGACY_MIGRATION_VERIFIED ' + JSON.stringify({records:converted.length,inserted,retained,destinationRecords:storedCount,photoReferences,uniquePhotos:uniquePhotos.size,photoBytes,sourceHash,destinationHash:digest(stable(converted))}));
}
main().catch(error => { console.error('Legacy import stopped:', error.message); process.exitCode = 1; });
