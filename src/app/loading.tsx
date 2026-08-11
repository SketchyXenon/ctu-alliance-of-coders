import { GearLogo } from "@/components/gear-logo";

export default function Loading() {
  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-navy-950 to-navy-900 text-white"
      aria-busy="true"
      aria-label="Loading Alliance of Coders"
    >
      <div className="relative z-10 flex flex-col items-center gap-4">
        <GearLogo size={56} />
        <div className="flex flex-col items-center gap-2">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.24em] text-white">
            Alliance of Coders
          </span>
          <div
            className="relative h-0.5 w-32 overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-label="Loading content"
          >
            <div
              className="absolute inset-y-0 w-1/2 rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, var(--gold-500), var(--gold-300))",
                animation: "loadingSlide 1.4s ease-in-out infinite",
              }}
            />
          </div>
          <span className="text-xs text-white/60">Loading...</span>
        </div>
      </div>
    </main>
  );
}
