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
      <path d="M5.3 7.2c3.7-3.4 9.5-3.1 13 .5 3.2 3.4 2.6 8.2-.8 10.7-3.5 2.7-8.6 1.7-11-1.9-2.2-3.2-1.7-7 .7-9.2" strokeWidth="1.35" />
      <path d="m6.7 8 10.4 9.4M17.7 8.4 7.2 15.8" opacity=".42" strokeWidth="1.1" />
      <circle cx="5.4" cy="7.2" fill="currentColor" r="1.7" stroke="none" />
      <circle cx="18.4" cy="7.9" fill="currentColor" r="1.7" stroke="none" />
      <circle cx="17.8" cy="18.1" fill="currentColor" r="1.7" stroke="none" />
      <circle cx="6.7" cy="16.7" fill="currentColor" r="1.7" stroke="none" />
    </svg>
  );
}

export function UserGlyph({ className, ...props }: ProductIconProps) {
  return (
    <svg {...sharedProps} {...props} className={className} viewBox="0 0 24 24">
      <path d="M4.8 10.8c.2-4.7 3.4-8 7.8-8 3.5 0 6.1 1.8 7 4.7" opacity=".34" strokeWidth="1.15" />
      <circle cx="12" cy="8.3" r="3" strokeWidth="1.4" />
      <path d="M6.6 19.7c.4-4.2 2.3-6.3 5.4-6.3s5 2.1 5.4 6.3" strokeWidth="1.45" />
      <circle cx="19.2" cy="6.3" fill="currentColor" r="1.35" stroke="none" />
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
      <path d="m8.4 5.2-5 6.8 5 6.8M15.6 5.2l5 6.8-5 6.8M13.7 3.8 10.3 20.2" strokeWidth="1.5" />
      <circle cx="12" cy="12" fill="currentColor" r="1.15" stroke="none" />
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
      <circle cx="18.7" cy="4.8" fill="currentColor" r="1.4" stroke="none" />
      <circle cx="19.3" cy="18.6" fill="currentColor" opacity=".55" r=".9" stroke="none" />
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
