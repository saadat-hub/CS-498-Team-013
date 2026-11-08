import { ArrowUpRight, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading, PageHeading, useData } from '../ui';
export default function SearchResults() {
  const [p] = useSearchParams(),
    q = p.get('q') ?? '',
    { data, loading, error, refresh } = useData(q ? `/search?q=${encodeURIComponent(q)}` : null);
  return (
    <>
      <PageHeading
        eyebrow="FOLLOW YOUR CURIOSITY"
        title={q ? `Results for “${q}”` : 'What would you like to explore?'}
        text="Find a challenge by its title, description, or topic."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : data?.items.length ? (
        <div className="search-results">
          {data.items.map((c: any) => (
            <Link className="card search-result" to={`/challenge/${c.slug}`} key={c.slug}>
              <Search size={20} />
              <div>
                <h3>{c.title}</h3>
                <p>{c.brief}</p>
              </div>
              <ArrowUpRight size={20} />
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Search />}
          title="Nothing here just yet"
          text="Try a broader search, such as Python, JSON, or debugging."
        />
      )}
    </>
  );
}
