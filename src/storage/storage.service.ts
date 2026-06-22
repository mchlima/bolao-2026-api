import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = config.get<string>('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('STORAGE_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('STORAGE_BUCKET') ?? '';
    this.publicBaseUrl = (
      config.get<string>('STORAGE_PUBLIC_BASE_URL') ?? ''
    ).replace(/\/$/, '');

    this.client =
      endpoint && accessKeyId && secretAccessKey && this.bucket
        ? new S3Client({
            region: config.get<string>('STORAGE_REGION') || 'auto',
            endpoint,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true,
          })
        : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** Optimize an image to WebP and upload to R2; returns the public URL. */
  async uploadImage(buffer: Buffer, prefix: string): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message:
          'Storage de imagens não configurado (defina STORAGE_* no .env).',
      });
    }

    const webp = await sharp(buffer)
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const key = `${prefix}/${randomUUID()}.webp`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }

  /**
   * Upload an ALREADY-ENCODED image buffer as-is (no resize/re-encode), returning
   * the public URL. Use for images we render at a specific size (e.g. match covers
   * in 1200×630) where the square 512 optimization of uploadImage() doesn't fit.
   */
  async uploadRaw(
    buffer: Buffer,
    prefix: string,
    contentType = 'image/webp',
    ext = 'webp',
  ): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Storage de imagens não configurado (defina STORAGE_* no .env).',
      });
    }
    const key = `${prefix}/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }

  /**
   * Best-effort removal of a previously-uploaded object, given its public URL.
   * Only deletes objects we own (URL under our public base); never throws — a
   * dangling object is acceptable, but failing the request over cleanup is not.
   */
  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!this.client || !url) return;
    const prefix = `${this.publicBaseUrl}/`;
    if (!url.startsWith(prefix)) return;
    const key = url.slice(prefix.length);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      // swallow: storage cleanup must not break the user-facing operation
    }
  }
}
