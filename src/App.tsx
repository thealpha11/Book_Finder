import React, { useEffect, useMemo, useState } from "react";

/* ============================ Types & Utils ============================ */
export type SearchMode = "all" | "title" | "author" | "subject";

type Doc = {
  key: string; // Open Library work key or GB id
  title: string;
  author_name?: string[];
  author_key?: string[];
  cover_i?: number;
  first_publish_year?: number;
  edition_count?: number;
  subject?: string[];
  // Google fallback
  thumb?: string;
};

type SearchResponse = {
  numFound: number;
  docs: Doc[];
  source?: "openlibrary" | "google";
};

type Fav = Pick<Doc, "key" | "title" | "author_name" | "cover_i" | "thumb">;

const cn = (...cls: Array<string | false | null | undefined>) =>
  cls.filter(Boolean).join(" ");

const formatAuthors = (arr?: string[]) =>
  arr && arr.length ? arr.join(", ") : "Unknown";

const coverUrl = (doc: Partial<Doc>, size: "S" | "M" | "L" = "M") => {
  if (doc.thumb) return doc.thumb!;
  if (doc.cover_i)
    return `https://covers.openlibrary.org/b/id/${doc.cover_i}-${size}.jpg`;
  return `https://placehold.co/200x300?text=No+Cover`;
};

function useDebouncedValue<T>(value: T, delay = 400) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setD(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return d;
}

/* ======================== LocalStorage favorites ======================= */
const FAV_KEY = "bookfinder:favs-ts";
const getFavs = (): Fav[] => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
};
const setFavs = (arr: Fav[]) => localStorage.setItem(FAV_KEY, JSON.stringify(arr));

/* =============================== API =================================== */
/** Open Library search (client-side sort/filter to keep it stable) */
async function searchOpenLibrary(opts: {
  q: string;
  mode: SearchMode;
  page?: number;
  sort?: "relevance" | "new" | "old";
  yearStart?: number;
  yearEnd?: number;
}): Promise<SearchResponse> {
  const { q, mode, page = 1, sort = "relevance", yearStart, yearEnd } = opts;
  const params = new URLSearchParams();
  params.set("page", String(page));

  // Build query by mode — either dedicated param or q-syntax
  if (mode === "all") {
    params.set("q", q || "");
  } else if (mode === "title") {
    params.set("title", q);
  } else if (mode === "author") {
    params.set("author", q);
  } else if (mode === "subject") {
    params.set("subject", q);
  }

  // Also add year bounds via q-syntax; OL ignores if empty
  if (yearStart || yearEnd) {
    const qYear = [
      yearStart ? `publish_year:>=${yearStart}` : null,
      yearEnd ? `publish_year:<=${yearEnd}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const baseQ = params.get("q");
    if (baseQ) params.set("q", `${baseQ} ${qYear}`.trim());
    else params.set("q", qYear);
  }

  const url = `https://openlibrary.org/search.json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenLibrary HTTP ${res.status}`);
  const json = (await res.json()) as SearchResponse;

  let docs = json.docs || [];
  // Client-side refine just in case
  if (yearStart || yearEnd) {
    docs = docs.filter((d) => {
      const y = d.first_publish_year ?? Number.NEGATIVE_INFINITY;
      const okStart = yearStart ? y >= yearStart : true;
      const okEnd = yearEnd ? y <= yearEnd : true;
      return okStart && okEnd;
    });
  }
  if (sort === "new")
    docs = [...docs].sort(
      (a, b) => (b.first_publish_year ?? 0) - (a.first_publish_year ?? 0)
    );
  if (sort === "old")
    docs = [...docs].sort(
      (a, b) => (a.first_publish_year ?? 0) - (b.first_publish_year ?? 0)
    );

  return { numFound: json.numFound ?? docs.length, docs, source: "openlibrary" };
}

/** Google Books fallback — CORS-friendly */
async function searchGoogleBooks(opts: {
  q: string;
  mode: SearchMode;
  page?: number;
  sort?: "relevance" | "new" | "old";
  yearStart?: number;
  yearEnd?: number;
}): Promise<SearchResponse> {
  const { q, mode, page = 1, sort = "relevance", yearStart, yearEnd } = opts;
  const maxResults = 20;
  const startIndex = (page - 1) * maxResults;

  let qBuilt = q.trim();
  if (mode === "title") qBuilt = `intitle:${qBuilt}`;
  if (mode === "author") qBuilt = `inauthor:${qBuilt}`;
  if (mode === "subject") qBuilt = `subject:${qBuilt}`;

  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
      qBuilt
    )}` +
    `&printType=books&startIndex=${startIndex}&maxResults=${maxResults}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`GoogleBooks HTTP ${r.status}`);
  const jb = await r.json();

  const items = Array.isArray(jb.items) ? jb.items : [];
  let docs: Doc[] = items.map((it: any) => {
    const v = it.volumeInfo || {};
    const y =
      typeof v.publishedDate === "string"
        ? parseInt(v.publishedDate.slice(0, 4), 10)
        : undefined;
    const thumb =
      (v.imageLinks?.thumbnail as string | undefined)?.replace(
        "http://",
        "https://"
      ) ||
      (v.imageLinks?.smallThumbnail as string | undefined)?.replace(
        "http://",
        "https://"
      );

    return {
      key: it.id,
      title: v.title || "Untitled",
      author_name: v.authors || [],
      author_key: [],
      first_publish_year: Number.isFinite(y) ? (y as number) : undefined,
      subject: v.categories || [],
      edition_count: v.pageCount ? 1 : undefined,
      thumb,
    };
  });

  if (yearStart || yearEnd) {
    docs = docs.filter((d) => {
      const y = d.first_publish_year ?? Number.NEGATIVE_INFINITY;
      const okStart = yearStart ? y >= yearStart : true;
      const okEnd = yearEnd ? y <= yearEnd : true;
      return okStart && okEnd;
    });
  }
  if (sort === "new")
    docs = [...docs].sort(
      (a, b) => (b.first_publish_year ?? 0) - (a.first_publish_year ?? 0)
    );
  if (sort === "old")
    docs = [...docs].sort(
      (a, b) => (a.first_publish_year ?? 0) - (b.first_publish_year ?? 0)
    );

  const numFound = typeof jb.totalItems === "number" ? jb.totalItems : docs.length;
  return { numFound, docs, source: "google" };
}

/** Wrapper — try OL, fallback to Google */
async function searchBooks(opts: {
  q: string;
  mode: SearchMode;
  page?: number;
  sort?: "relevance" | "new" | "old";
  yearStart?: number;
  yearEnd?: number;
}): Promise<SearchResponse> {
  try {
    return await searchOpenLibrary(opts);
  } catch {
    return await searchGoogleBooks(opts);
  }
}

/* ================================ UI ==================================== */
export default function App() {
  const [query, setQuery] = useState("harry potter");
  const debouncedQuery = useDebouncedValue(query, 500);

  const [mode, setMode] = useState<SearchMode>("all");
  const [yearStart, setYearStart] = useState(1950);
  const [yearEnd, setYearEnd] = useState(new Date().getFullYear());
  const [sort, setSort] = useState<"relevance" | "new" | "old">("relevance");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<Doc | Fav | null>(null);
  const [favs, setFavsState] = useState<Fav[]>(getFavs());

  const totalPages = useMemo(
    () => (data?.numFound ? Math.min(Math.ceil(data.numFound / 100), 100) : 0),
    [data]
  );
  const inFavs = (key: string) => favs.some((f) => f.key === key);
  const toggleFav = (doc: Doc | Fav) => {
    const next = inFavs(doc.key)
      ? favs.filter((f) => f.key !== doc.key)
      : [
          {
            key: doc.key,
            title: doc.title,
            cover_i: (doc as Doc).cover_i,
            author_name: (doc as Doc).author_name,
            thumb: (doc as Doc).thumb,
          },
          ...favs,
        ].slice(0, 50);
    setFavsState(next);
    setFavs(next);
  };

  useEffect(() => setPage(1), [debouncedQuery, sort, yearStart, yearEnd, mode]);

  useEffect(() => {
    let ignore = false;
    async function run() {
      if (!debouncedQuery.trim()) {
        setData(null);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const json = await searchBooks({
          q: debouncedQuery,
          mode,
          page,
          sort,
          yearStart,
          yearEnd,
        });
        if (!ignore) setData(json);
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Something went wrong");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => {
      ignore = true;
    };
  }, [debouncedQuery, page, sort, yearStart, yearEnd, mode]);

  const docs = data?.docs || [];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/70 border-b border-neutral-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block w-5 h-5 rounded bg-green-500" />
              Book Finder
            </h1>
            <p className="text-sm text-neutral-400">Open Library API • Search, filter, and save favorites</p>
          </div>
          <a
            href="https://openlibrary.org/developers/api"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-300 hover:underline"
          >
            API Docs
          </a>
        </div>
      </header>

      {/* Controls */}
      <section className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-5">
            <label className="text-xs text-neutral-400">Search books</label>
            <input
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Try 'Harry Potter', 'React', 'Stephen King'..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {/* NEW: Search mode */}
          <div className="md:col-span-3">
            <label className="text-xs text-neutral-400">Mode</label>
            <select
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-3"
              value={mode}
              onChange={(e) => setMode(e.target.value as SearchMode)}
            >
              <option value="all">All</option>
              <option value="title">Title</option>
              <option value="author">Author</option>
              <option value="subject">Subject</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-neutral-400">Sort</label>
            <select
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-3"
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
            >
              <option value="relevance">Relevance</option>
              <option value="new">Newest</option>
              <option value="old">Oldest</option>
            </select>
          </div>
          <div className="md:col-span-2 flex gap-2">
            <button
              onClick={() => setQuery("")}
              className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-3 hover:bg-neutral-800"
              title="Clear search"
            >
              Clear
            </button>
            <button
              onClick={() => {
                setYearStart(1800);
                setYearEnd(new Date().getFullYear());
                setSort("relevance");
                setMode("all");
                setQuery("harry potter");
              }}
              className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-3 hover:bg-neutral-800"
              title="Reset"
            >
              Reset
            </button>
          </div>

          {/* Year Range */}
          <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
            <div className="md:col-span-1 text-xs text-neutral-400">Year range</div>
            <div className="md:col-span-2 flex items-center gap-3">
              <input
                type="number"
                className="w-28 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2"
                value={yearStart}
                min={1500}
                max={yearEnd}
                onChange={(e) => setYearStart(Number(e.target.value || 0))}
              />
              <div className="text-neutral-500">—</div>
              <input
                type="number"
                className="w-28 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2"
                value={yearEnd}
                min={yearStart}
                max={new Date().getFullYear()}
                onChange={(e) => setYearEnd(Number(e.target.value || 0))}
              />
            </div>
            <div className="md:col-span-2 text-xs text-neutral-500">
              Filters use publish_year bounds (inclusive).
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 pb-24">
        {error && (
          <div className="mb-4 p-3 rounded-xl border border-red-800 bg-red-950 text-red-200">{error}</div>
        )}

        <div className="flex items-center justify-between py-2">
          <div className="text-sm text-neutral-400">
            {loading ? (
              "Loading…"
            ) : data ? (
              <>
                Found <span className="text-neutral-200">{data.numFound.toLocaleString()}</span> results
                {data.source && <span className="ml-2 text-neutral-500">(via {data.source})</span>}
              </>
            ) : (
              "Type to search"
            )}
          </div>
          <FavTray
            favs={favs}
            onSelect={(f) => setSelected(f)}
            onRemove={(f) => toggleFav(f)}
          />
        </div>

        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {loading
            ? Array.from({ length: 10 }, (_, i) => <SkeletonCard key={i} />)
            : docs.map((doc) => (
                <BookCard
                  key={doc.key}
                  doc={doc}
                  onClick={() => setSelected(doc)}
                  faved={inFavs(doc.key)}
                  onFav={() => toggleFav(doc)}
                />
              ))}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 disabled:opacity-40"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <span className="text-sm text-neutral-400">
              Page {page} / {totalPages}
            </span>
            <button
              className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 disabled:opacity-40"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </main>

      {selected && (
        <DetailModal
          doc={selected as Doc}
          onClose={() => setSelected(null)}
          onFav={() => toggleFav(selected)}
          faved={inFavs(selected.key)}
        />
      )}

      <footer className="fixed bottom-3 right-3 text-[10px] text-neutral-400 bg-neutral-900/70 border border-neutral-800 rounded-full px-3 py-1">
        Built for a Web Dev take‑home • React + Tailwind • Open Library API (GB fallback)
      </footer>
    </div>
  );
}

/* ============================== Components ============================== */
function BookCard({
  doc,
  onClick,
  faved,
  onFav,
}: {
  doc: Doc;
  onClick: () => void;
  faved: boolean;
  onFav: () => void;
}) {
  return (
    <div className="group relative bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden hover:border-neutral-700 transition">
      <button onClick={onClick} className="text-left w-full">
        <div className="aspect-[2/3] overflow-hidden">
          <img
            src={coverUrl(doc, "L")}
            alt={doc.title}
            className="w-full h-full object-cover group-hover:scale-105 transition"
            loading="lazy"
          />
        </div>
        <div className="p-3">
          <h3 className="font-medium leading-tight line-clamp-2">{doc.title}</h3>
          <p className="mt-1 text-xs text-neutral-400 line-clamp-1">{formatAuthors(doc.author_name)}</p>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-500">
            {doc.first_publish_year && <span>First: {doc.first_publish_year}</span>}
            {doc.edition_count && <span>• {doc.edition_count} eds</span>}
          </div>
        </div>
      </button>
      <button
        onClick={onFav}
        title={faved ? "Remove from favorites" : "Save to favorites"}
        className={cn(
          "absolute top-2 right-2 rounded-full px-2.5 py-1.5 text-[11px] border",
          faved
            ? "bg-yellow-200 text-black border-yellow-300"
            : "bg-neutral-950/70 border-neutral-700 hover:bg-neutral-800"
        )}
      >
        {faved ? "★" : "☆"}
      </button>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-[2/3] bg-neutral-800" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-neutral-800 rounded" />
        <div className="h-3 bg-neutral-800 rounded w-2/3" />
      </div>
    </div>
  );
}

function FavTray({
  favs,
  onSelect,
  onRemove,
}: {
  favs: Fav[];
  onSelect: (f: Fav) => void;
  onRemove: (f: Fav) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 hover:bg-neutral-800"
      >
        Favorites ({favs.length})
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] bg-neutral-950 border border-neutral-800 rounded-xl p-3 shadow-2xl max-h-96 overflow-auto z-10">
          {favs.length === 0 ? (
            <div className="text-xs text-neutral-500">No favorites yet. Click ☆ on a book to save it.</div>
          ) : (
            <ul className="space-y-2">
              {favs.map((f) => (
                <li key={f.key} className="flex gap-2 items-center">
                  <img src={coverUrl(f, "S")} alt="cover" className="w-10 h-14 object-cover rounded" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{f.title}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{formatAuthors(f.author_name)}</div>
                  </div>
                  <button
                    onClick={() => onSelect(f)}
                    className="text-[10px] px-2 py-1 bg-neutral-900 border border-neutral-800 rounded hover:bg-neutral-800"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => onRemove(f)}
                    className="text-[10px] px-2 py-1 border border-neutral-700 rounded hover:bg-neutral-800"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-28 shrink-0 text-xs text-neutral-400 mt-1">{label}</div>
      <div className="text-sm text-neutral-200">{children}</div>
    </div>
  );
}

function DetailModal({
  doc,
  onClose,
  onFav,
  faved,
}: {
  doc: Doc;
  onClose: () => void;
  onFav: () => void;
  faved: boolean;
}) {
  const workId = doc.key?.startsWith("/works/") ? doc.key : null;
  const workUrl = workId ? `https://openlibrary.org${workId}` : null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <h2 className="font-semibold truncate pr-4">{doc.title}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={onFav}
                className={cn(
                  "text-xs px-2 py-1 rounded border",
                  faved
                    ? "bg-yellow-200 text-black border-yellow-300"
                    : "bg-neutral-900 border-neutral-800"
                )}
              >
                {faved ? "★ Saved" : "☆ Save"}
              </button>
              <button
                onClick={onClose}
                className="text-xs px-2 py-1 rounded border border-neutral-800 hover:bg-neutral-900"
              >
                Close
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
            <div>
              <img
                src={coverUrl(doc, "L")}
                alt="cover"
                className="w-full rounded-xl border border-neutral-800"
              />
            </div>
            <div className="md:col-span-2 space-y-3">
              <Row label="Authors">{formatAuthors(doc.author_name)}</Row>
              <Row label="First published">{doc.first_publish_year || "—"}</Row>
              <Row label="Subjects">
                {doc.subject ? (
                  <div className="flex flex-wrap gap-2">
                    {doc.subject.slice(0, 12).map((s) => (
                      <span
                        key={s}
                        className="text-[10px] px-2 py-1 rounded-full bg-neutral-900 border border-neutral-800"
                      >
                        {s}
                      </span>
                    ))}
                    {doc.subject?.length > 12 && (
                      <span className="text-[10px] text-neutral-500">
                        +{doc.subject.length - 12} more
                      </span>
                    )}
                  </div>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Open Library">
                {workUrl ? (
                  <a
                    href={workUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-300 hover:underline"
                  >
                    View work page ↗
                  </a>
                ) : (
                  "—"
                )}
              </Row>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
