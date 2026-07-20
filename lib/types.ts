export type CourseType = "tax" | "english" | "digital" | "other";

export type CourseInput = {
  date: string;
  weekday: string;
  period: string;
  start_time: string;
  end_time: string;
  course_name: string;
  teacher: string;
  class_name: string;
  classroom: string;
  remark: string;
  course_type: CourseType;
  source_page?: number;
};

export type Course = CourseInput & {
  id: string;
  version_id?: string;
  upload_id?: string;
};

export type VersionMeta = {
  id: string;
  label: string;
  updated_at: string;
  remark: string;
  source_filename: string;
};

export type UploadRecord = {
  id: string;
  filename: string;
  uploaded_at: string;
  status: string;
  warnings: string;
  published_version_id: string | null;
};

