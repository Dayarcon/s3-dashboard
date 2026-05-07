import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  GetBucketLocationCommand,
} from '@aws-sdk/client-s3';
import { config } from './config';
import { formatBytes } from './utils';
import { logger } from './logger';

// Default client (fallback) - used for global operations like listBuckets
export const defaultClient = new S3Client({ region: config.s3.defaultRegion });

// us-east-1 client specifically for GetBucketLocation (AWS-recommended)
const usEast1Client = new S3Client({ region: 'us-east-1' });

const regionClientCache = new Map<string, S3Client>();

export function getClientForRegion(region?: string): S3Client {
  if (!region) return defaultClient;
  if (!regionClientCache.has(region)) {
    regionClientCache.set(region, new S3Client({ region }));
  }
  return regionClientCache.get(region)!;
}

// ----- bucket location cache -----------------------------------------------
// GetBucketLocation is rarely changing data and we hit it on every list/get/put.
// Cache for the configured TTL (default 1 hour). Keyed by bucket name.

type CacheEntry = { region: string; expiresAt: number };
const locationCache = new Map<string, CacheEntry>();

export function invalidateBucketLocation(bucket: string) {
  locationCache.delete(bucket);
}

async function fetchBucketLocation(bucket: string): Promise<string> {
  const cmd = new GetBucketLocationCommand({ Bucket: bucket });
  const res = await usEast1Client.send(cmd);
  // us-east-1 returns null per AWS contract.
  return (res.LocationConstraint as string | null) || 'us-east-1';
}

export async function getBucketLocation(bucket: string): Promise<string> {
  const now = Date.now();
  const cached = locationCache.get(bucket);
  if (cached && cached.expiresAt > now) return cached.region;
  try {
    const region = await fetchBucketLocation(bucket);
    locationCache.set(bucket, {
      region,
      expiresAt: now + config.s3.bucketLocationCacheTtlMs,
    });
    return region;
  } catch (err: any) {
    logger.warn({ bucket, err: err?.message || err }, 'getBucketLocation_failed');
    throw err;
  }
}

// ----- helpers --------------------------------------------------------------

async function streamToString(stream: any) {
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ----- buckets --------------------------------------------------------------

export async function listBuckets() {
  const cmd = new ListBucketsCommand({});
  const res = await defaultClient.send(cmd);
  return (res.Buckets || []).map((b) => ({ name: b.Name, creationDate: b.CreationDate }));
}

export async function listBucketsWithRegion() {
  const buckets = await listBuckets();
  const enriched = await Promise.all(
    buckets.map(async (b) => {
      try {
        const location = await getBucketLocation(b.name!);
        return { ...b, region: location };
      } catch (err: any) {
        const errorCode = err?.Code || err?.code || err?.name || 'UnknownError';
        const errorMessage = err?.message || 'Failed to get bucket location';
        if (errorCode === 'NoSuchBucket' || errorCode === 'ENOTFOUND' || errorCode === 'NetworkError') {
          return { ...b, region: 'unknown', error: 'Bucket not found or inaccessible' };
        }
        if (errorCode === 'AccessDenied') {
          return { ...b, region: 'unknown', error: 'Access denied' };
        }
        return { ...b, region: 'unknown', error: errorMessage };
      }
    })
  );
  return enriched;
}

export async function listBucketsByRegions(regions?: string[]) {
  const enriched = await listBucketsWithRegion();
  if (!regions || regions.length === 0) return enriched;
  const regionSet = new Set(regions);
  return enriched.filter((b) => b.region && regionSet.has(b.region));
}

// ----- objects --------------------------------------------------------------

/**
 * List a single page at the given prefix. Pagination is exposed via
 * continuationToken in/out, so the UI can fetch additional pages when needed.
 */
export async function listAtPrefix(
  bucket: string,
  prefix = '',
  opts: { maxKeys?: number; continuationToken?: string } = {}
) {
  const maxKeys = Math.min(Math.max(opts.maxKeys ?? 1000, 1), 1000);
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const params: any = {
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/',
    MaxKeys: maxKeys,
  };
  if (opts.continuationToken) params.ContinuationToken = opts.continuationToken;
  const cmd = new ListObjectsV2Command(params);
  const res = await client.send(cmd);
  const folders = (res.CommonPrefixes || []).map((p) => p.Prefix);
  const files = (res.Contents || [])
    .filter((obj) => obj.Key !== prefix)
    .map((obj) => ({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified }));
  return {
    folders,
    files,
    isTruncated: !!res.IsTruncated,
    nextContinuationToken: res.NextContinuationToken,
  };
}

export async function getObjectContent(bucket: string, key: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(cmd);
  return await streamToString(res.Body);
}

export async function getObjectMetadata(bucket: string, key: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(cmd);
  return {
    key,
    size: res.ContentLength,
    lastModified: res.LastModified,
    contentType: res.ContentType,
    etag: res.ETag,
    metadata: res.Metadata,
  };
}

export async function putObjectContent(bucket: string, key: string, body: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body });
  await client.send(cmd);
}

export async function deleteObject(bucket: string, key: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await client.send(cmd);
}

export async function deleteObjects(bucket: string, keys: string[]) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: keys.map((key) => ({ Key: key })) },
  });
  const res = await client.send(cmd);
  return {
    deleted: res.Deleted?.map((d) => d.Key) || [],
    errors: res.Errors || [],
  };
}

export async function copyObject(bucket: string, sourceKey: string, destKey: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
    Key: destKey,
  });
  await client.send(cmd);
}

export async function moveObject(bucket: string, sourceKey: string, destKey: string) {
  await copyObject(bucket, sourceKey, destKey);
  await deleteObject(bucket, sourceKey);
}

export async function createFolder(bucket: string, folderPath: string) {
  const folderKey = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: folderKey, Body: '' });
  await client.send(cmd);
}

// ----- metrics --------------------------------------------------------------

export async function getBucketMetrics(bucket: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);

  let totalSize = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    });
    const res = await client.send(cmd);
    for (const obj of res.Contents || []) {
      totalSize += obj.Size || 0;
      objectCount++;
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return {
    bucketName: bucket,
    totalSize,
    objectCount,
    sizeFormatted: formatBytes(totalSize),
  };
}

export async function getAllBucketsWithMetrics() {
  const buckets = await listBuckets();

  const results = await Promise.allSettled(
    buckets.map(async (bucket) => {
      const [metrics, location] = await Promise.all([
        getBucketMetrics(bucket.name!),
        getBucketLocation(bucket.name!),
      ]);
      return { ...bucket, ...metrics, location };
    })
  );

  return results.map((r, idx) => {
    if (r.status === 'fulfilled') return r.value;
    const err: any = r.reason;
    const errorMessage = err?.message || 'Failed to get metrics';
    logger.warn(
      { bucket: buckets[idx].name, err: errorMessage },
      'getAllBucketsWithMetrics_partial_failure'
    );
    return {
      ...buckets[idx],
      totalSize: 0,
      objectCount: 0,
      sizeFormatted: '0 B',
      location: 'unknown',
      error: errorMessage,
    };
  });
}

export async function getDetailedBucketMetrics(bucket: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);

  let totalSize = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;
  const storageClasses: Record<string, { size: number; count: number }> = {};
  const extensions: Record<string, { size: number; count: number }> = {};
  let lastModifiedOldest: Date | null = null;
  let lastModifiedNewest: Date | null = null;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    });
    const res = await client.send(cmd);

    for (const obj of res.Contents || []) {
      const size = obj.Size || 0;
      totalSize += size;
      objectCount++;

      const storageClass = obj.StorageClass || 'STANDARD';
      if (!storageClasses[storageClass]) storageClasses[storageClass] = { size: 0, count: 0 };
      storageClasses[storageClass].size += size;
      storageClasses[storageClass].count++;

      const ext = obj.Key?.split('.').pop()?.toLowerCase() || 'no_extension';
      if (!extensions[ext]) extensions[ext] = { size: 0, count: 0 };
      extensions[ext].size += size;
      extensions[ext].count++;

      if (obj.LastModified) {
        if (!lastModifiedOldest || obj.LastModified < lastModifiedOldest) {
          lastModifiedOldest = obj.LastModified;
        }
        if (!lastModifiedNewest || obj.LastModified > lastModifiedNewest) {
          lastModifiedNewest = obj.LastModified;
        }
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return {
    bucketName: bucket,
    totalSize,
    objectCount,
    sizeFormatted: formatBytes(totalSize),
    storageClasses: Object.entries(storageClasses).map(([name, data]) => ({
      name,
      ...data,
      sizeFormatted: formatBytes(data.size),
    })),
    topExtensions: Object.entries(extensions)
      .map(([ext, data]) => ({ ext, ...data, sizeFormatted: formatBytes(data.size) }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10),
    oldestObject: lastModifiedOldest,
    newestObject: lastModifiedNewest,
    avgObjectSize: objectCount > 0 ? Math.round(totalSize / objectCount) : 0,
    avgObjectSizeFormatted: formatBytes(
      objectCount > 0 ? Math.round(totalSize / objectCount) : 0
    ),
  };
}
