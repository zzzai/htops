import { describe, expect, it, vi } from "vitest";
import { HetangOpsStore } from "./store.js";

function buildLockTestStore(params: {
  tryLockResult?: boolean;
}) {
  const clientQuery = vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: params.tryLockResult ?? true }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const client = {
    query: clientQuery,
    release,
  };
  const poolQuery = vi.fn();
  const connect = vi.fn(async () => client);
  const store = new HetangOpsStore({
    pool: {
      connect,
      query: poolQuery,
    } as never,
    stores: [],
  });
  return {
    store,
    connect,
    poolQuery,
    clientQuery,
    release,
  };
}

describe("HetangOpsStore advisory locks", () => {
  it("holds tryAdvisoryLock on a dedicated client until releaseAdvisoryLock", async () => {
    const { store, connect, poolQuery, clientQuery, release } = buildLockTestStore({});

    await expect(store.tryAdvisoryLock(42_060_406)).resolves.toBe(true);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("pg_try_advisory_lock"),
      [42_060_406],
    );
    expect(release).not.toHaveBeenCalled();

    await store.releaseAdvisoryLock(42_060_406);

    expect(clientQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("pg_advisory_unlock"),
      [42_060_406],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the client immediately when tryAdvisoryLock does not acquire the lock", async () => {
    const { store, connect, poolQuery, clientQuery, release } = buildLockTestStore({
      tryLockResult: false,
    });

    await expect(store.tryAdvisoryLock(42_060_406)).resolves.toBe(false);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("pg_try_advisory_lock"),
      [42_060_406],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reuses the same held client for nested acquire/release on the same lock key", async () => {
    const { store, connect, clientQuery, release } = buildLockTestStore({});

    await expect(store.acquireAdvisoryLock(42_060_406)).resolves.toBe(true);
    await expect(store.acquireAdvisoryLock(42_060_406)).resolves.toBe(true);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledTimes(1);

    await store.releaseAdvisoryLock(42_060_406);
    expect(release).not.toHaveBeenCalled();

    await store.releaseAdvisoryLock(42_060_406);
    expect(clientQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("pg_advisory_unlock"),
      [42_060_406],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
