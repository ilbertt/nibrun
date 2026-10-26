import { Link } from '@tanstack/react-router';
import { APPS } from '#lib/apps.ts';
import { POSTS } from '#lib/blog.ts';

const FEATURED_COUNT = 3;
const FEATURED_APPS = APPS.filter((app) => app.isRecommended).slice(0, FEATURED_COUNT);
const LATEST_POSTS = POSTS.slice(0, FEATURED_COUNT);

export function Explore() {
  return (
    <div className="grid w-full grid-cols-1 gap-12 border-border/60 border-t py-16 sm:grid-cols-2">
      <section aria-labelledby="explore-apps">
        <h2 id="explore-apps" className="pb-6 font-semibold text-2xl tracking-tight">
          Ready to deploy
        </h2>
        <ul className="flex flex-col gap-5">
          {FEATURED_APPS.map((app) => (
            <li key={app.slug}>
              <Link
                to="/apps/$slug"
                params={{ slug: app.slug }}
                className="group flex flex-col gap-1"
              >
                <span className="font-medium group-hover:text-primary">Deploy {app.title}</span>
                <span className="text-muted-foreground text-sm">{app.subtitle}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          to="/apps"
          search={{ category: undefined }}
          className="mt-6 inline-block text-primary underline"
        >
          Browse all apps
        </Link>
      </section>
      <section aria-labelledby="explore-blog">
        <h2 id="explore-blog" className="pb-6 font-semibold text-2xl tracking-tight">
          From the blog
        </h2>
        <ul className="flex flex-col gap-5">
          {LATEST_POSTS.map((post) => (
            <li key={post.slug}>
              <Link
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="group flex flex-col gap-1"
              >
                <span className="font-medium group-hover:text-primary">{post.title}</span>
                <span className="text-muted-foreground text-sm">{post.description}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/blog" className="mt-6 inline-block text-primary underline">
          Read all posts
        </Link>
      </section>
    </div>
  );
}
