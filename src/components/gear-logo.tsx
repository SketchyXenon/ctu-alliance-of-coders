import Image from "next/image";
import { cn } from "@/lib/utils";

interface GearLogoProps {
  size?: number;
  className?: string;
  spin?: boolean;
  /** Spin the gear continuously on hover (used in nav brand). */
  spinOnHover?: boolean;
}

/**
 * GearLogo - Alliance of Coders official logo.
 * Uses the PNG brand mark with optional slow spin animation.
 *
 * `spinOnHover` adds a group-hover spin so the gear rotates when the user
 * hovers the parent brand button - a subtle, on-brand micro-interaction.
 */
export function GearLogo({ size = 48, className, spin = false, spinOnHover = false }: GearLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center transition-transform duration-500",
        spin && "gear-spin",
        spinOnHover && "group-hover:rotate-90 group-hover:transition-transform group-hover:duration-700",
        className
      )}
      style={{ width: size, height: size }}
      aria-label="Alliance of Coders logo"
      role="img"
    >
      <Image
        src="/logo.png"
        alt="Alliance of Coders"
        width={size}
        height={size}
        priority
        className="object-contain"
      />
    </span>
  );
}
