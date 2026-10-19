/** The founder attachment is currently inaccessible (HTTP 403). This is an
 * explicit dependency placeholder, never a reconstructed wordmark. Replace only
 * with the verified original and record its checksum in the evidence report. */
export function BrandAsset({ lockup = false }: { lockup?: boolean }) {
  return (
    <span className={`brand-asset-placeholder ${lockup ? "lockup" : ""}`}>
      <span>Original logo pending</span>
      {lockup && <span>Your money, and what's next.</span>}
    </span>
  );
}
