/** Shared type aliases used across packages. */
export type Maybe<T> = T | null | undefined;
export type NonEmptyArray<T> = readonly [T, ...T[]];
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T extends object ? DeepReadonly<T[K]> : T[K];
};
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Environment = "development" | "test" | "staging" | "production";

export type Listener<T> = (event: T) => void;

export interface Disposable {
  dispose(): void;
}
