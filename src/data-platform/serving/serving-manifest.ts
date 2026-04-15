type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export async function publishServingManifest(
  queryable: Queryable,
  servingVersion: string,
  publishedAt: string,
  notes?: string,
): Promise<void> {
  await queryable.query(
    `
      INSERT INTO serving_manifest (serving_version, published_at, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (serving_version) DO UPDATE SET
        published_at = EXCLUDED.published_at,
        notes = EXCLUDED.notes
    `,
    [servingVersion, publishedAt, notes ?? null],
  );
}

export async function getCurrentServingVersion(queryable: Queryable): Promise<string | null> {
  const result = await queryable.query(
    `
      SELECT serving_version
      FROM serving_manifest
      ORDER BY published_at DESC, serving_version DESC
      LIMIT 1
    `,
  );
  return (result.rows[0]?.serving_version as string | undefined) ?? null;
}
