export type PointsMeta = {
  n: number;
  price_unit: number;
  has_expected: boolean;
  captured_to: string;
  columns: { name: string; type: string; offset: number }[];
  departments: string[];
  cities: [string, number][];
  neighborhoods: string[];
  amenities: string[];
  owner_groups: string[];
};

export type Points = {
  meta: PointsMeta;
  n: number;
  id: Uint32Array;
  area: Float32Array;
  price: Uint32Array;
  expected: Uint32Array;
  dept: Uint8Array;
  city: Uint16Array;
  hood: Uint16Array;
  beds: Uint8Array;
  baths: Uint8Array;
  stratum: Uint8Array;
  amen: Uint16Array;
  owner: Uint8Array;
  active?: Uint8Array;
};

const ARRAY_TYPES = {
  uint32: Uint32Array,
  float32: Float32Array,
  uint16: Uint16Array,
  uint8: Uint8Array,
} as const;

let cached: Promise<Points> | null = null;

export function loadPoints(): Promise<Points> {
  cached ??= (async () => {
    const [metaRes, binRes] = await Promise.all([fetch("/data/points.json"), fetch("/data/points.bin.gz")]);
    if (!metaRes.ok || !binRes.ok || !binRes.body) throw new Error("No se pudieron cargar los anuncios");
    const meta = (await metaRes.json()) as PointsMeta;
    const buffer = await new Response(binRes.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const columns: Record<string, ArrayLike<number>> = {};
    for (const column of meta.columns) {
      const Type = ARRAY_TYPES[column.type as keyof typeof ARRAY_TYPES];
      columns[column.name] = new Type(buffer, column.offset, meta.n);
    }
    return { meta, n: meta.n, ...columns } as unknown as Points;
  })().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}
