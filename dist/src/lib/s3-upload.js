"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isS3Configured = isS3Configured;
exports.uploadBufferToS3 = uploadBufferToS3;
exports.logS3ConfigOnce = logS3ConfigOnce;
const client_s3_1 = require("@aws-sdk/client-s3");
const logger_1 = require("./logger");
function getS3Client() {
    const bucket = process.env.S3_BUCKET?.trim();
    const region = process.env.S3_REGION?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
        return null;
    }
    return new client_s3_1.S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
    });
}
function isS3Configured() {
    return getS3Client() !== null;
}
async function uploadBufferToS3(params) {
    const client = getS3Client();
    const bucket = process.env.S3_BUCKET?.trim();
    const publicBase = process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
    if (!client || !bucket) {
        throw new Error("S3 is not configured");
    }
    await client.send(new client_s3_1.PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
    }));
    if (publicBase && publicBase.length > 0) {
        return `${publicBase}/${params.key}`;
    }
    const region = process.env.S3_REGION ?? "us-east-1";
    const encodedKey = encodeURIComponent(params.key).replace(/%2F/g, "/");
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}
function logS3ConfigOnce() {
    if (isS3Configured()) {
        logger_1.logger.info("s3_upload_enabled", { bucket: process.env.S3_BUCKET });
    }
}
