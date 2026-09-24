/**
 * A tiny in-memory stand-in for the Supabase query builder, covering what the
 * CLI-auth and agent code uses: from().select/insert/update + eq/is/lt/gt/
 * order/limit + single/maybeSingle, awaited directly or via .then().
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private conflict: string[] = [];
  private ignoreDuplicates = false;
  private patch: Row = {};
  private returning = false;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;

  constructor(
    private readonly rows: Row[],
    private readonly fail: boolean
  ) {}

  select(_columns?: string) {
    if (this.op === 'select') this.op = 'select';
    else this.returning = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = 'insert';
    this.patch = Array.isArray(row) ? (row[0] ?? {}) : row;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  upsert(row: Row, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.patch = row;
    this.conflict = (opts.onConflict ?? 'id').split(',').map((c) => c.trim());
    this.ignoreDuplicates = opts.ignoreDuplicates === true;
    return this;
  }
  ilike(column: string, value: string) {
    this.filters.push((r) => String(r[column]).toLowerCase() === value.toLowerCase());
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((r) => typeof r[column] === 'string' && r[column] < value);
    return this;
  }
  gt(column: string, value: string) {
    this.filters.push((r) => typeof r[column] === 'string' && r[column] > value);
    return this;
  }
  order(column: string, opts: { ascending: boolean }) {
    this.orderBy = { column, ascending: opts.ascending };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybeSingle';
    return this;
  }

  private execute(): { data: unknown; error: unknown } {
    if (this.fail) return { data: null, error: { message: 'db down' } };
    if (this.op === 'insert') {
      const row = { id: `id-${String(this.rows.length + 1)}`, ...this.patch };
      this.rows.push(row);
      if (!this.returning) return { data: null, error: null };
      return { data: this.mode === 'many' ? [row] : row, error: null };
    }
    if (this.op === 'upsert') {
      const existing = this.rows.find((r) => this.conflict.every((c) => r[c] === this.patch[c]));
      if (existing) {
        if (!this.ignoreDuplicates) Object.assign(existing, this.patch);
      } else {
        this.rows.push({ ...this.patch });
      }
      return { data: null, error: null };
    }
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'delete') {
      for (const r of matched) this.rows.splice(this.rows.indexOf(r), 1);
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      for (const r of matched) Object.assign(r, this.patch);
      return { data: this.returning ? matched : null, error: null };
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      matched = [...matched].sort((a, b) =>
        String(a[column]) < String(b[column]) ? (ascending ? -1 : 1) : ascending ? 1 : -1
      );
    }
    if (this.max !== null) matched = matched.slice(0, this.max);
    if (this.mode === 'many') return { data: matched, error: null };
    const first = matched[0] ?? null;
    if (this.mode === 'single' && !first) return { data: null, error: { message: 'no rows' } };
    return { data: first, error: null };
  }

  then<A = { data: unknown; error: unknown }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export function createMemoryDb(tables: Record<string, Row[]> = {}) {
  const failing = new Set<string>();
  const rpcHandlers: Record<string, (args: Row) => { data: unknown; error: unknown }> = {};
  return {
    tables,
    failTable(name: string) {
      failing.add(name);
    },
    onRpc(name: string, handler: (args: Row) => { data: unknown; error: unknown }) {
      rpcHandlers[name] = handler;
    },
    from(name: string) {
      tables[name] ??= [];
      return new Query(tables[name], failing.has(name));
    },
    auth: {
      admin: {
        getUserById(id: string) {
          const user = (tables.__users ?? []).find((u) => u.id === id) ?? null;
          return Promise.resolve({ data: { user }, error: null });
        },
      },
    },
    rpc(name: string, args: Row) {
      const handler = rpcHandlers[name];
      return Promise.resolve(
        handler ? handler(args) : { data: null, error: { message: 'no rpc' } }
      );
    },
  };
}
