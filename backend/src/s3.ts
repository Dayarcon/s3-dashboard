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
  GetBucketLocationCommand
} from '@aws-sdk/client-s3';

// Default client (fallback) - used for global operations like listBuckets
export const defaultClient = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

// us-east-1 client specifically for GetBucketLocation (AWS-recommended region for this API)
const usEast1Client = new S3Client({ region: 'us-east-1' });

// Cache region-specific clients to avoid creating new ones on every call
const regionClientCache = new Map<string, S3Client>();

/**
 * Returns an S3 client configured for the specified region.
 * If region is undefined or empty, falls back to the default client.
 */
export function getClientForRegion(region?: string): S3Client {
  if (!region) return defaultClient;
  if (!regionClientCache.has(region)) {
    regionClientCache.set(region, new S3Client({ region }));
  }
  return regionClientCache.get(region)!;
}

async function streamToString(stream: any) {
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function listBuckets() {
  const cmd = new ListBucketsCommand({});
  const res = await defaultClient.send(cmd);
  return (res.Buckets || []).map(b => ({ name: b.Name, creationDate: b.CreationDate }));
}

// List all buckets enriched with their region/location
export async function listBucketsWithRegion() {
  const buckets = await listBuckets();
  const enriched = await Promise.all(
    buckets.map(async (b) => {
      try {
        const location = await getBucketLocation(b.name!);
        return { ...b, region: location };
      } catch (err: any) {
        // Handle specific error cases
        const errorCode = err?.Code || err?.code || err?.name || 'UnknownError';
        const errorMessage = err?.message || 'Failed to get bucket location';

        // Log different levels of errors
        if (errorCode === 'NoSuchBucket' || errorCode === 'ENOTFOUND' || errorCode === 'NetworkError') {
          console.warn(`Bucket '${b.name}' not found or inaccessible: ${errorMessage}`);
          return { ...b, region: 'unknown', error: 'Bucket not found or inaccessible' };
        } else if (errorCode === 'AccessDenied') {
          console.warn(`Access denied to bucket '${b.name}': ${errorMessage}`);
          return { ...b, region: 'unknown', error: 'Access denied' };
        } else {
          console.warn(`Failed to get location for bucket '${b.name}': ${errorMessage}`);
          return { ...b, region: 'unknown', error: errorMessage };
        }
      }
    })
  );
  // Return all buckets, including those with errors (so UI can show them)
  return enriched;
}

/**
 * Returns buckets enriched with region information, optionally filtered by a list of regions.
 * If `regions` is omitted or empty, all buckets are returned.
 */
export async function listBucketsByRegions(regions?: string[]) {
  const enriched = await listBucketsWithRegion();
  if (!regions || regions.length === 0) return enriched;
  const regionSet = new Set(regions);
  return enriched.filter(b => b.region && regionSet.has(b.region));
}

export async function listAtPrefix(bucket: string, prefix = '', maxKeys = 1000) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const params = { Bucket: bucket, Prefix: prefix, Delimiter: '/', MaxKeys: maxKeys };
  const cmd = new ListObjectsV2Command(params);
  const res = await client.send(cmd);
  const folders = (res.CommonPrefixes || []).map(p => p.Prefix);
  const files = (res.Contents || [])
    .filter(obj => obj.Key !== prefix)
    .map(obj => ({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified }));
  return { folders, files };
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
    metadata: res.Metadata
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
    Delete: {
      Objects: keys.map(key => ({ Key: key }))
    }
  });
  const res = await client.send(cmd);
  return {
    deleted: res.Deleted?.map(d => d.Key) || [],
    errors: res.Errors || []
  };
}

export async function copyObject(bucket: string, sourceKey: string, destKey: string) {
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${sourceKey}`,
    Key: destKey
  });
  await client.send(cmd);
}

export async function moveObject(bucket: string, sourceKey: string, destKey: string) {
  await copyObject(bucket, sourceKey, destKey);
  await deleteObject(bucket, sourceKey);
}

export async function createFolder(bucket: string, folderPath: string) {
  // Ensure folder path ends with '/'
  const folderKey = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: folderKey,
    Body: ''
  });
  await client.send(cmd);
}

// Get bucket location — uses us-east-1 client (AWS-recommended for this API)
export async function getBucketLocation(bucket: string) {
  try {
    const cmd = new GetBucketLocationCommand({ Bucket: bucket });
    const res = await usEast1Client.send(cmd);
    return res.LocationConstraint || 'us-east-1'; // us-east-1 returns null
  } catch (err: any) {
    console.warn(`getBucketLocation error for ${bucket}:`, err?.message || err);
    throw err; // Re-throw to let caller handle it
  }
}

// Calculate bucket metrics (size and object count)
export async function getBucketMetrics(bucket: string) {
  // Determine bucket region first
  const bucketRegion = await getBucketLocation(bucket);
  const client = getClientForRegion(bucketRegion);

  let totalSize = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken
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
    sizeFormatted: formatBytes(totalSize)
  };
}

// Format bytes to human-readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get all buckets with metrics
export async function getAllBucketsWithMetrics() {
  const buckets = await listBuckets();
  const metrics = [];

  for (const bucket of buckets) {
    try {
      const bucketMetrics = await getBucketMetrics(bucket.name!);
      const location = await getBucketLocation(bucket.name!);
      metrics.push({
        ...bucket,
        ...bucketMetrics,
        location
      });
    } catch (err: any) {
      const errorCode = err?.Code || err?.code || err?.name || 'UnknownError';
      const errorMessage = err?.message || 'Failed to get metrics';

      // Log the error for debugging
      if (errorCode === 'NoSuchBucket' || errorCode === 'ENOTFOUND' || errorCode === 'NetworkError') {
        console.warn(`Bucket '${bucket.name}' not found or inaccessible, skipping: ${errorMessage}`);
      } else if (errorCode === 'AccessDenied') {
        console.warn(`Access denied to bucket '${bucket.name}', skipping: ${errorMessage}`);
      } else {
        console.warn(`Failed to get metrics for bucket '${bucket.name}': ${errorMessage}`);
      }

      // Include the bucket in results with error info (so UI can show it)
      metrics.push({
        ...bucket,
        totalSize: 0,
        objectCount: 0,
        sizeFormatted: '0 B',
        location: 'unknown',
        error: errorMessage
      });
    }
  }

  return metrics;
}

// Get detailed bucket metrics including storage class breakdown
export async function getDetailedBucketMetrics(bucket: string) {
  // Determine bucket region first
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
      ContinuationToken: continuationToken
    });
    const res = await client.send(cmd);

    for (const obj of res.Contents || []) {
      const size = obj.Size || 0;
      totalSize += size;
      objectCount++;

      // Storage class breakdown
      const storageClass = obj.StorageClass || 'STANDARD';
      if (!storageClasses[storageClass]) {
        storageClasses[storageClass] = { size: 0, count: 0 };
      }
      storageClasses[storageClass].size += size;
      storageClasses[storageClass].count++;

      // File extension breakdown
      const ext = obj.Key?.split('.').pop()?.toLowerCase() || 'no_extension';
      if (!extensions[ext]) {
        extensions[ext] = { size: 0, count: 0 };
      }
      extensions[ext].size += size;
      extensions[ext].count++;

      // Date range
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
      sizeFormatted: formatBytes(data.size)
    })),
    topExtensions: Object.entries(extensions)
      .map(([ext, data]) => ({ ext, ...data, sizeFormatted: formatBytes(data.size) }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10),
    oldestObject: lastModifiedOldest,
    newestObject: lastModifiedNewest,
    avgObjectSize: objectCount > 0 ? Math.round(totalSize / objectCount) : 0,
    avgObjectSizeFormatted: formatBytes(objectCount > 0 ? Math.round(totalSize / objectCount) : 0)
  };
}
