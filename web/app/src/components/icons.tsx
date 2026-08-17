/** Small inline icons. Stroke-based, sized by the `size` prop, coloured by currentColor. */

interface IconProps {
  size?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false as const,
  };
}

export const CheckIcon = ({ size = 13 }: IconProps) => (
  <svg {...base(size)} strokeWidth={3}>
    <path d="M4 12.5 9.5 18 20 6.5" />
  </svg>
);

export const CrossIcon = ({ size = 13 }: IconProps) => (
  <svg {...base(size)} strokeWidth={3}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const SearchIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.6-3.6" />
  </svg>
);

export const ChevronIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 9.5 12 15.5 18 9.5" />
  </svg>
);

export const AlertIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </svg>
);

export const InfoIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16.5V11M12 7.5h.01" />
  </svg>
);

export const SunIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </svg>
);

export const MoonIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 14.2A8.3 8.3 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z" />
  </svg>
);
