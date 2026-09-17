import React from "react";

interface CloudScopeLogoProps {
  size?: number;
  className?: string;
}

/** CloudScope 品牌标志：开放的 C 形镜头环与中心聚焦点。 */
export const CloudScopeLogo: React.FC<CloudScopeLogoProps> = ({ size = 32, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="cloudscope-logo-gradient" x1="7" y1="5" x2="34" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#2563EB" />
        <stop offset="1" stopColor="#0D9488" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#cloudscope-logo-gradient)" />
    <path
      d="M26.7 12.6A10 10 0 1 0 26.7 27.4"
      stroke="white"
      strokeWidth="3.2"
      strokeLinecap="round"
    />
    <circle cx="20" cy="20" r="2.6" fill="white" />
    <path d="M27 20H32" stroke="#A5F3FC" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
