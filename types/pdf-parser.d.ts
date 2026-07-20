declare module "@/lib/pdf-parser.mjs" {
  import type { CourseInput } from "@/lib/types";
  export function parseCoursePdf(file: File, onProgress?: (progress: number) => void): Promise<{ courses: CourseInput[]; warnings: string[] }>;
}

