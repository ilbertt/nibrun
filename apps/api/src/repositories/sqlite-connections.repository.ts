import type { AppId, GuestPath } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId, SqliteConnectionId } from '#lib/api/identifiers.ts';
import { Repository } from '#repositories/repository.ts';

export type SqliteConnectionRow = Queries['SelectSqliteConnectionById'];
export type SqliteConnectionsByAppInput = { appId: AppId; ownerId: OwnerId };
export type CreateSqliteConnectionInput = SqliteConnectionsByAppInput & { path: GuestPath };
export type SqliteConnectionByIdInput = { id: SqliteConnectionId; ownerId: OwnerId };
export type DeleteSqliteConnectionInput = SqliteConnectionByIdInput & { appId: AppId };

export abstract class SqliteConnectionsRepositoryContract {
  abstract create(input: CreateSqliteConnectionInput): Promise<SqliteConnectionRow | null>;
  abstract listByApp(input: SqliteConnectionsByAppInput): Promise<SqliteConnectionRow[]>;
  abstract findById(input: SqliteConnectionByIdInput): Promise<SqliteConnectionRow | null>;
  abstract remove(input: DeleteSqliteConnectionInput): Promise<boolean>;
}

export class SqliteConnectionsRepository
  extends Repository
  implements SqliteConnectionsRepositoryContract
{
  async create({
    appId,
    ownerId,
    path,
  }: CreateSqliteConnectionInput): Promise<SqliteConnectionRow | null> {
    const [row] = await this.sql.InsertSqliteConnection`
      INSERT INTO nibrun.sqlite_connections (app_id, sqlite_file_path)
      SELECT a.id, ${path} FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      RETURNING id, app_id, sqlite_file_path, created_at
    `;
    return row ?? null;
  }

  listByApp({ appId, ownerId }: SqliteConnectionsByAppInput): Promise<SqliteConnectionRow[]> {
    return this.sql.SelectSqliteConnectionsByApp`
      SELECT c.id, c.app_id, c.sqlite_file_path, c.created_at
      FROM nibrun.sqlite_connections c
      JOIN nibrun.live_apps a ON a.id = c.app_id
      WHERE c.app_id = ${appId} AND a.owner_id = ${ownerId}
      ORDER BY c.id DESC
    `;
  }

  async findById({ id, ownerId }: SqliteConnectionByIdInput): Promise<SqliteConnectionRow | null> {
    const [row] = await this.sql.SelectSqliteConnectionById`
      SELECT c.id, c.app_id, c.sqlite_file_path, c.created_at
      FROM nibrun.sqlite_connections c
      JOIN nibrun.live_apps a ON a.id = c.app_id
      WHERE c.id = ${id} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }

  async remove({ appId, id, ownerId }: DeleteSqliteConnectionInput): Promise<boolean> {
    const rows = await this.sql.DeleteSqliteConnection`
      DELETE FROM nibrun.sqlite_connections c USING nibrun.live_apps a
      WHERE c.id = ${id} AND c.app_id = ${appId}
        AND a.id = c.app_id AND a.owner_id = ${ownerId}
      RETURNING c.id
    `;
    return rows.length > 0;
  }
}
