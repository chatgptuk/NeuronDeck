import type { SVGProps } from "react";

type ProductIconProps = Omit<SVGProps<SVGSVGElement>, "children">;

const sharedProps = {
  "aria-hidden": true,
  fill: "none",
  focusable: false,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function NeuronGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <rect x="4" y="7" width="10" height="13" rx="5" strokeWidth="1.8" />
      <rect x="10" y="4" width="10" height="13" rx="5" strokeWidth="1.8" />
    </svg>
  );
}

export function UserGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" strokeWidth="1.7" />
      <path d="M5.5 20v-1a6.5 6.5 0 0 1 13 0v1" strokeWidth="1.7" />
    </svg>
  );
}

export function ChatGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <path d="M4 6.4c0-1.5 1.2-2.7 2.7-2.7h10.6c1.5 0 2.7 1.2 2.7 2.7v7.1c0 1.5-1.2 2.7-2.7 2.7h-5.8L7 20v-3.8h-.3A2.7 2.7 0 0 1 4 13.5V6.4Z" strokeWidth="1.4" />
      <path d="M8 9.9h5.4" opacity=".5" strokeWidth="1.25" />
      <circle cx="16.6" cy="9.9" fill="currentColor" r="1.25" stroke="none" />
    </svg>
  );
}

export function IdeaGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <path d="M8.5 13.5A6 6 0 1 1 15.6 13c-1 .8-1.4 1.7-1.5 2.8H9.8c-.1-.9-.4-1.6-1.3-2.3Z" strokeWidth="1.45" />
      <path d="M9.7 18h4.6M10.7 20.7h2.6M12 1V.2M4.2 4.4l-.7-.7M19.8 4.4l.7-.7" strokeWidth="1.35" />
      <circle cx="12" cy="9.2" fill="currentColor" r="1.35" stroke="none" />
    </svg>
  );
}

export function CodeGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" strokeWidth="1.7" />
    </svg>
  );
}

export function PerspectiveGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <path d="m4 7.2 8-4.4 8 4.4-8 4.4-8-4.4Z" strokeWidth="1.45" />
      <path d="m4 11.8 8 4.4 8-4.4M4 16.3l8 4.4 8-4.4" opacity=".7" strokeWidth="1.35" />
      <circle cx="12" cy="7.2" fill="currentColor" r="1.25" stroke="none" />
    </svg>
  );
}

export function CreationGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <path d="M11.2 3.1c.2 4.8 2.7 7.3 7.6 7.6-4.9.3-7.4 2.8-7.6 7.6-.2-4.8-2.7-7.3-7.6-7.6 4.9-.3 7.4-2.8 7.6-7.6Z" strokeWidth="1.35" />
      <path d="M19 2v5m-2.5-2.5h5" strokeWidth="1.5" />
    </svg>
  );
}

export function ContextGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="7.7" strokeWidth="1.35" />
      <path d="M4.7 12h14.6M12 4.3c2 2.1 3.1 4.7 3.1 7.7S14 17.6 12 19.7C10 17.6 8.9 15 8.9 12S10 6.4 12 4.3Z" opacity=".65" strokeWidth="1.15" />
    </svg>
  );
}
