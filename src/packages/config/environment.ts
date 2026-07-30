export type Environment = "development" | "test" | "staging" | "production";

const RAW_ENV = (process.env.NODE_ENV ?? "development").toLowerCase() as Environment;

export function currentEnvironment(): Environment {
  if (RAW_ENV === "production" || RAW_ENV === "staging" || RAW_ENV === "test") return RAW_ENV;
  return "development";
}

export function isProduction(): boolean {
  return currentEnvironment() === "production";
}
export function isStaging(): boolean {
  return currentEnvironment() === "staging";
}
export function isTest(): boolean {
  return currentEnvironment() === "test";
}
export function isDevelopment(): boolean {
  return currentEnvironment() === "development";
}
