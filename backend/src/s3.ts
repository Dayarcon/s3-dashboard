import { 
  S3Client, 
  ListBucketsCommand, 
  ListObjectsV2Command, 
  GetObjectCommand, 
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'ap-south-1';
export const client = new S3Client({ region: REGION });

async function streamToString(stream: any) {
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function listBuckets() {
  const cmd = new ListBucketsCommand({});
  const res = await client.send(cmd);
  return (res.Buckets || []).map(b => ({ name: b.Name, creationDate: b.CreationDate }));
}

export async function listAtPrefix(bucket: string, prefix = '', maxKeys = 1000) {
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
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(cmd);
  return await streamToString(res.Body);
}

export async function getObjectMetadata(bucket: string, key: string) {
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
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body });
  await client.send(cmd);
}

export async function deleteObject(bucket: string, key: string) {
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await client.send(cmd);
}

export async function deleteObjects(bucket: string, keys: string[]) {
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
