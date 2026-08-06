export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./src/lib/env");
    try {
      getEnv();
    } catch (e) {
      console.error(
        "FATAL: environment validation failed at boot:",
        e instanceof Error ? e.message : e,
      );
      process.exit(1);
    }
  }
}
