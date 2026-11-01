import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names, letting later Tailwind utilities override earlier ones (shadcn's helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
