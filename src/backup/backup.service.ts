import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Off-site database backup. Runs entirely inside the app as a scheduled job —
 * no external cron, no worker, no exposed endpoint. Daily it runs `pg_dump`
 * (custom format) against the self-hosted Postgres over the docker network and
 * ships the dump to a private R2 bucket, then prunes dumps older than the
 * retention window. The VPS Postgres has no managed backups, so this is the
 * only off-site copy: lose the disk and this is what restores production.
 *
 * Production only (dev shares the staging DB and has no backup creds). Wholly
 * best-effort: a failure logs a warning and never touches the running app.
 * Restore procedure lives in RESTORE.md (drill it — an untested dump is not a
 * backup). pg_dump comes from `postgresql-client-17` baked into the image.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private running = false;

  private readonly bucket = process.env.BACKUP_STORAGE_BUCKET ?? '';
  private readonly retentionDays = Number(
    process.env.BACKUP_RETENTION_DAYS ?? 7,
  );

  private readonly client: S3Client | null;

  constructor() {
    const endpoint = process.env.BACKUP_STORAGE_ENDPOINT;
    const accessKeyId = process.env.BACKUP_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.BACKUP_STORAGE_SECRET_ACCESS_KEY;
    this.client =
      endpoint && accessKeyId && secretAccessKey && this.bucket
        ? new S3Client({
            region: process.env.BACKUP_STORAGE_REGION || 'auto',
            endpoint,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true,
            // R2 rejects the SDK's default flexible checksums on some ops.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          })
        : null;
  }

  // Daily at 04:00 UTC (01:00 BRT) — a quiet hour, offset from the 06:00 jobs.
  @Cron('0 4 * * *')
  async tick(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    if (!this.client) {
      this.logger.warn('backup skipped: BACKUP_STORAGE_* not configured');
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      this.logger.warn(`backup failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<void> {
    if (!this.client) return;
    const key = `db/${this.stamp()}.dump`;
    const dump = await this.pgDump();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: dump,
        ContentType: 'application/octet-stream',
      }),
    );
    const pruned = await this.prune();
    this.logger.log(
      `backup ok: ${key} (${Math.round(dump.length / 1024)} KB)` +
        (pruned ? `, pruned ${pruned} old` : ''),
    );
  }

  /** Run pg_dump -Fc against the configured DB; resolve with the archive buffer. */
  private pgDump(): Promise<Buffer> {
    const url = new URL(
      process.env.DIRECT_URL || process.env.DATABASE_URL || '',
    );
    const args = [
      '-h',
      url.hostname,
      '-p',
      url.port || '5432',
      '-U',
      decodeURIComponent(url.username),
      '-d',
      url.pathname.replace(/^\//, '') || 'postgres',
      '-Fc', // custom format: compressed, supports selective pg_restore
      '--no-owner',
      '--no-acl',
    ];
    return new Promise((resolve, reject) => {
      const child = spawn('pg_dump', args, {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      });
      const chunks: Buffer[] = [];
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('error', reject); // e.g. pg_dump binary missing
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`pg_dump exited ${code}: ${stderr.trim()}`));
      });
    });
  }

  /** Delete dumps under db/ older than the retention window. Returns count. */
  private async prune(): Promise<number> {
    if (!this.client) return 0;
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    let pruned = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: 'db/',
          ContinuationToken: token,
        }),
      );
      for (const obj of page.Contents ?? []) {
        if (
          obj.Key &&
          obj.LastModified &&
          obj.LastModified.getTime() < cutoff
        ) {
          await this.client.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.Key }),
          );
          pruned++;
        }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return pruned;
  }

  /** UTC YYYY-MM-DD_HHmmss, matching the manual drill's naming. */
  private stamp(): string {
    return new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '');
  }
}
