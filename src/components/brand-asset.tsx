import Image from "next/image";

/** Pixel-preserving crops/inversions of the founder's original JPEG.
 * Source checksum and exact crop bounds are recorded in public/brand/provenance.json. */
export function BrandAsset({ lockup = false }: { lockup?: boolean }) {
  return (
    <span className={`brand-asset ${lockup ? "lockup" : ""}`}>
      <Image
        src={
          lockup
            ? "/brand/agus-lockup-dark.png"
            : "/brand/agus-wordmark-dark.png"
        }
        alt={lockup ? "agus. — Your money, and what's next." : "agus."}
        width={642}
        height={lockup ? 263 : 208}
        unoptimized
        loading="eager"
      />
    </span>
  );
}
