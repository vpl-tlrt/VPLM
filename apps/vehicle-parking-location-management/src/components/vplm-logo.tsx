import type { SVGProps } from 'react';

/** Transparent VPLM parking/location brand mark. UI colors are inherited
 * from the surrounding theme; the parking P uses the teal brand accent. */
export function VplmLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="120 50 900 1230" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={className} role="img" aria-label="VPLM logo" {...props}>
      <g stroke="currentColor" strokeWidth="39" strokeLinejoin="round" strokeLinecap="square">
        <path d="M225 745 C131 587 135 386 237 249 C331 116 479 77 601 95 C812 125 947 282 954 480 C958 594 927 698 857 783"/>
        <path d="M381 595 V462 C381 355 458 287 557 287 C655 287 739 356 739 461 C739 563 660 640 556 640 H322 L179 876"/>
        <path d="M380 708 V948 L560 1256 L741 948"/>
        <path d="M506 650 V872 H941 L793 695 L731 774 L687 716 L582 871"/>
        <path d="M283 793 L378 940"/>
      </g>
      <path d="M741 948 L661 972 L723 1018 Z" fill="currentColor"/>
      <text x="554" y="478" textAnchor="middle" dominantBaseline="middle"
        fontFamily="Inter,Arial,sans-serif" fontWeight="700" fontSize="256" fill="#2dd4bf">P</text>
    </svg>
  );
}
