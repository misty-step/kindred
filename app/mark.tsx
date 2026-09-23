import { useId } from "react";

/** Two overlapping rings; the overlap is the only color. Decorative. */
export function Mark({
  className,
  stroke = 2,
}: {
  className?: string;
  stroke?: number;
}) {
  const clip = useId();
  return (
    <svg className={className} viewBox="0 0 30 20" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="10" cy="10" r="8.25" />
        </clipPath>
      </defs>
      <circle
        cx="20"
        cy="10"
        r="8.25"
        fill="#f6c744"
        clipPath={`url(#${clip})`}
      />
      <circle
        cx="10"
        cy="10"
        r="8.25"
        fill="none"
        stroke="#141414"
        strokeWidth={stroke}
      />
      <circle
        cx="20"
        cy="10"
        r="8.25"
        fill="none"
        stroke="#141414"
        strokeWidth={stroke}
      />
    </svg>
  );
}
