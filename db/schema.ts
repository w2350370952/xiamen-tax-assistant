import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  label: text("label").notNull().unique(),
  updatedAt: text("updated_at").notNull(),
  remark: text("remark").notNull().default(""),
  sourceFilename: text("source_filename").notNull().default(""),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  status: text("status").notNull(),
  r2Key: text("r2_key").notNull().default(""),
  warnings: text("warnings").notNull().default("[]"),
  publishedVersionId: text("published_version_id"),
});

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id").notNull(),
    date: text("date").notNull(),
    weekday: text("weekday").notNull(),
    period: text("period").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    courseName: text("course_name").notNull(),
    teacher: text("teacher").notNull().default(""),
    className: text("class_name").notNull().default(""),
    classroom: text("classroom").notNull().default(""),
    remark: text("remark").notNull().default(""),
    courseType: text("course_type").notNull().default("other"),
  },
  (table) => [index("courses_version_date_idx").on(table.versionId, table.date)],
);

export const draftCourses = sqliteTable(
  "draft_courses",
  {
    id: text("id").primaryKey(),
    uploadId: text("upload_id").notNull(),
    date: text("date").notNull(),
    weekday: text("weekday").notNull(),
    period: text("period").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    courseName: text("course_name").notNull(),
    teacher: text("teacher").notNull().default(""),
    className: text("class_name").notNull().default(""),
    classroom: text("classroom").notNull().default(""),
    remark: text("remark").notNull().default(""),
    courseType: text("course_type").notNull().default("other"),
    sourcePage: integer("source_page").notNull().default(0),
  },
  (table) => [index("draft_courses_upload_date_idx").on(table.uploadId, table.date)],
);

