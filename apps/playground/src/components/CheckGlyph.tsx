/** The tick a copy button wears while it is confirming, in the builder and in the code panel. */
export function CheckGlyph() {
  return (
    <svg className="copied-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
