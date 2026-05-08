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
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';
import { formatBytes } from './utils';
import { logger } from './logger';

// Workspace-scoped client cache: key = "workspaceId:region"
const clientCache = new Map<string, S3Client>();

// Workspace-scoped location cache: key = "workspaceId:bucket"
type CacheEntry = { region: string; expiresAt: number };
const locationCache = new Map<string, CacheEntry>();

// Get or create S3 client for workspace + region
// If credentials provided, create a new client; otherwise use default
export function getClientForWorkspace(
  workspaceId: number,
  creds?: { accessKeyId: string; secretAccessKey: string },
  region?: string
): S3Client {
  const clientRegion = region || config.s3.defaultRegion;
  const cacheKey = `${workspaceId}:${clientRegion}`;

  // If no credentials, return a client from cache
  if (!creds) {
    if (!clientCache.has(cacheKey)) {
      clientCache.set(cacheKey, new S3Client({ region: clientRegion }));
    }
    return clientCache.get(cacheKey)!;
  }

  // If credentials provided, create a new client with those credentials
  // Don't cache credential-based clients to avoid credential leakage across requests
  return new S3Client({
    region: clientRegion,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

// Invalidate all cached clients for a workspace (e.g., after credential rotation)
export function invalidateWorkspaceClients(workspaceId: number): void {
  const keysToDelete: string[] = [];
  for (const key of clientCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach((key) => clientCache.delete(key));

  // Also invalidate location cache for this workspace
  const locKeysToDelete: string[] = [];
  for (const key of locationCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      locKeysToDelete.push(key);
    }
  }
  locKeysToDelete.forEach((key) => locationCache.delete(key));
}

// ----- bucket location cache -----------------------------------------------
// GetBucketLocation is rarely changing data and we hit it on every list/get/put.
// Cache for the configured TTL (default 1 hour). Keyed by "workspaceId:bucket".

export function invalidateBucketLocation(workspaceId: number, bucket: string): void {
  locationCache.delete(`${workspaceId}:${bucket}`);
}

async function fetchBucketLocation(
  workspaceId: number,
  bucket: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
): Promise<string> {
  // Use us-east-1 client for GetBucketLocation (AWS-recommended)
  const client = getClientForWorkspace(workspaceId, creds, 'us-east-1');
  const cmd = new GetBucketLocationCommand({ Bucket: bucket });
  const res = await client.send(cmd);
  return (res.LocationConstraint as string | null) || 'us-east-1';
}

export async function getBucketLocation(
  workspaceId: number,
  bucket: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
): Promise<string> {
  const cacheKey = `${workspaceId}:${bucket}`;
  const now = Date.now();
  const cached = locationCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.region;
  try {
    const region = await fetchBucketLocation(workspaceId, bucket, creds);
    locationCache.set(cacheKey, {
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

export async function listBuckets(
  workspaceId: number,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const client = getClientForWorkspace(workspaceId, creds);
  const cmd = new ListBucketsCommand({});
  const res = await client.send(cmd);
  return (res.Buckets || []).map((b) => ({ name: b.Name, creationDate: b.CreationDate }));
}

export async function listBucketsWithRegion(
  workspaceId: number,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const buckets = await listBuckets(workspaceId, creds);
  const enriched = await Promise.all(
    buckets.map(async (b) => {
      try {
        const location = await getBucketLocation(workspaceId, b.name!, creds);
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

export async function listBucketsByRegions(
  workspaceId: number,
  creds?: { accessKeyId: string; secretAccessKey: string },
  regions?: string[]
) {
  const enriched = await listBucketsWithRegion(workspaceId, creds);
  if (!regions || regions.length === 0) return enriched;
  const regionSet = new Set(regions);
  return enriched.filter((b) => b.region && regionSet.has(b.region));
}

// ----- objects --------------------------------------------------------------

export async function listAtPrefix(
  workspaceId: number,
  bucket: string,
  creds?: { accessKeyId: string; secretAccessKey: string },
  prefix = '',
  opts: { maxKeys?: number; continuationToken?: string } = {}
) {
  const maxKeys = Math.min(Math.max(opts.maxKeys ?? 1000, 1), 1000);
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
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

export async function getObjectContent(
  workspaceId: number,
  bucket: string,
  key: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(cmd);
  return await streamToString(res.Body);
}

export async function getObjectMetadata(
  workspaceId: number,
  bucket: string,
  key: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
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

export async function putObjectContent(
  workspaceId: number,
  bucket: string,
  key: string,
  body: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body });
  await client.send(cmd);
}

export async function deleteObject(
  workspaceId: number,
  bucket: string,
  key: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await client.send(cmd);
}

export async function deleteObjects(
  workspaceId: number,
  bucket: string,
  keys: string[],
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
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

export async function copyObject(
  workspaceId: number,
  bucket: string,
  sourceKey: string,
  destKey: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
  const cmd = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
    Key: destKey,
  });
  await client.send(cmd);
}

export async function moveObject(
  workspaceId: number,
  bucket: string,
  sourceKey: string,
  destKey: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  await copyObject(workspaceId, bucket, sourceKey, destKey, creds);
  await deleteObject(workspaceId, bucket, sourceKey, creds);
}

export async function createFolder(
  workspaceId: number,
  bucket: string,
  folderPath: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const folderKey = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: folderKey, Body: '' });
  await client.send(cmd);
}

// ----- metrics --------------------------------------------------------------

export async function getBucketMetrics(
  workspaceId: number,
  bucket: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);

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

export async function getAllBucketsWithMetrics(
  workspaceId: number,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const buckets = await listBuckets(workspaceId, creds);

  const results = await Promise.allSettled(
    buckets.map(async (bucket) => {
      const [metrics, location] = await Promise.all([
        getBucketMetrics(workspaceId, bucket.name!, creds),
        getBucketLocation(workspaceId, bucket.name!, creds),
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

export async function getDetailedBucketMetrics(
  workspaceId: number,
  bucket: string,
  creds?: { accessKeyId: string; secretAccessKey: string }
) {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);

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
      totalSize += obj.Size || 0;
      objectCount++;

      // Track storage class
      const storageClass = obj.StorageClass || 'STANDARD';
      if (!storageClasses[storageClass]) {
        storageClasses[storageClass] = { size: 0, count: 0 };
      }
      storageClasses[storageClass].size += obj.Size || 0;
      storageClasses[storageClass].count++;

      // Track extensions
      const ext = obj.Key?.split('.').pop() || 'no-ext';
      if (!extensions[ext]) {
        extensions[ext] = { size: 0, count: 0 };
      }
      extensions[ext].size += obj.Size || 0;
      extensions[ext].count++;

      // Track oldest/newest
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
    storageClasses,
    extensions,
    lastModifiedOldest,
    lastModifiedNewest,
  };
}

// ----- presigned URLs -------------------------------------------------------

export async function generatePresignedUrl(
  workspaceId: number,
  bucket: string,
  key: string,
  expiresIn: number,
  creds?: { accessKeyId: string; secretAccessKey: string }
): Promise<string> {
  const bucketRegion = await getBucketLocation(workspaceId, bucket, creds);
  const client = getClientForWorkspace(workspaceId, creds, bucketRegion);
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  try {
    const url = await getSignedUrl(client, cmd, { expiresIn });
    return url;
  } catch (err: any) {
    logger.error({ bucket, key, err: err?.message || err }, 'generatePresignedUrl_failed');
    throw err;
  }
}
