# Restauração do banco (backups R2)

A produção roda Postgres self-hosted no VPS (serviço `db` do compose) sem backup
gerenciado. O único backup off-site são os dumps que o `BackupService` (job
`@Cron` diário, `src/backup/backup.service.ts`) envia para o bucket **privado**
R2 `craveibkp`, prefixo `db/`, no formato custom do `pg_dump` (`-Fc`). Retenção
padrão: 7 dias (`BACKUP_RETENTION_DAYS`).

> **Um dump que nunca foi restaurado não é um backup.** Refaça o drill abaixo de
> tempos em tempos. Drill validado pela primeira vez em 2026-06-15 (bateu 100%
> com a prod: matches/users/predictions).

## 1. Listar / baixar um backup

Credenciais R2 em `CREDENTIALS.local.md` (raiz, gitignored). Com `aws` CLI
apontando pro endpoint R2 — **sempre** com os flags de checksum (R2 rejeita o
checksum default do SDK):

```bash
export AWS_ACCESS_KEY_ID=<BACKUP_STORAGE_ACCESS_KEY_ID>
export AWS_SECRET_ACCESS_KEY=<BACKUP_STORAGE_SECRET_ACCESS_KEY>
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
EP=https://3b7f10a3f5621eff61565aba6e31942e.r2.cloudflarestorage.com

aws s3 ls s3://craveibkp/db/ --endpoint-url "$EP"                 # listar
aws s3 cp s3://craveibkp/db/<arquivo>.dump ./restore.dump --endpoint-url "$EP"
```

## 2. Validar o arquivo (sem restaurar)

```bash
pg_restore --list ./restore.dump | grep -c 'TABLE DATA'   # deve ser ~18 tabelas
```

## 3. Drill — restaurar num banco ISOLADO (nunca sobre a prod)

```bash
export PGPASSWORD=<senha do postgres>   # CREDENTIALS.local.md
H=191.252.110.66                        # ou `db` se rodando dentro do VPS

createdb -h $H -U postgres craveibkp_restore_test
pg_restore -h $H -U postgres -d craveibkp_restore_test --no-owner --no-acl ./restore.dump

# conferir que bate com a prod:
psql -h $H -U postgres -d craveibkp_restore_test -c \
  "select count(*) from matches; select count(*) from users;"

dropdb -h $H -U postgres craveibkp_restore_test   # limpar
```

## 4. Restauração REAL (recuperação de desastre)

Só quando a prod estiver perdida/corrompida. No VPS, com a API parada para não
escrever durante o restore:

```bash
cd /opt/bolao-2026-api
docker compose stop api
# recriar o banco do zero e restaurar:
docker compose exec -T db dropdb -U postgres --force postgres
docker compose exec -T db createdb -U postgres postgres
docker compose exec -T db pg_restore -U postgres -d postgres --no-owner --no-acl < ./restore.dump
docker compose start api      # sobe e roda `prisma migrate deploy` (no-op se o dump já está atual)
```

`pg_restore` requer o client/servidor v17 (a imagem da API traz
`postgresql-client-17`; o container `db` é `postgres:17`).
