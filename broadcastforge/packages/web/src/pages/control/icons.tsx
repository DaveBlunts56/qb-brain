export { Hand, Pencil } from 'lucide-react';

/** Small American football glyph (lucide has no football icon). */
export function Football({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)" />
      <path d="M9.5 14.5l5-5M10.5 11.5l2 2M12 10l2 2" />
    </svg>
  );
}
