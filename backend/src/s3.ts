import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const client = new S3Client({ region: REGION });

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
  // @ts-ignore
  return await streamToString(res.Body);
}

export async function putObjectContent(bucket: string, key: string, body: string) {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body });
  await client.send(cmd);
}
