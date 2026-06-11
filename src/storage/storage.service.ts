import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
    this.publicBaseUrl = (config.get<string>('STORAGE_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');

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
        message: 'Storage de imagens não configurado (defina STORAGE_* no .env).',
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
}
