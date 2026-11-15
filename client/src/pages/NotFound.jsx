import { BookOpen } from 'lucide-react';
import { useDocumentTitle } from '../hooks';
import { Button } from '../components/ui';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <BookOpen className="size-12 text-accent" strokeWidth={1.3} />
      <p className="eyebrow mt-6">Error 404</p>
      <h1 className="mt-3 text-5xl">This page went missing from the shelf</h1>
      <p className="mt-4 max-w-md text-ink-soft">The link may be broken or the page may have moved. Let’s get you back to the books.</p>
      <div className="mt-8 flex gap-3">
        <Button as="link" to="/">Go home</Button>
        <Button as="link" to="/shop" variant="secondary">Browse books</Button>
      </div>
    </div>
  );
}
