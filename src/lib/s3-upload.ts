import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { logger } from "./logger";

function getS3Client(): S3Client | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const region = process.env.S3_REGION?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function isS3Configured(): boolean {
  return getS3Client() !== null;
}

export async function uploadBufferToS3(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const client = getS3Client();
  const bucket = process.env.S3_BUCKET?.trim();
  const publicBase = process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");

  if (!client || !bucket) {
    throw new Error("S3 is not configured");
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );

  if (publicBase && publicBase.length > 0) {
    return `${publicBase}/${params.key}`;
  }

  const region = process.env.S3_REGION ?? "us-east-1";
  const encodedKey = encodeURIComponent(params.key).replace(/%2F/g, "/");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function logS3ConfigOnce(): void {
  if (isS3Configured()) {
    logger.info("s3_upload_enabled", { bucket: process.env.S3_BUCKET });
  }
}
