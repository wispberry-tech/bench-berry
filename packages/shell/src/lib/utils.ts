// Class-name combiner for the UI primitives: clsx joins, tailwind-merge
// de-duplicates conflicting utilities in v4-generated class strings.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}