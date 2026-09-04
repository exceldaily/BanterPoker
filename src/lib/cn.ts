import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class merger. Plain module so server components can use it too. */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return twMerge(clsx(inputs));
}
