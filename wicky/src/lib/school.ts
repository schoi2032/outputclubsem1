export const SCHOOL_DOMAIN = "chadwickschool.org";

export function isSchoolEmail(email?: string | null) {
  return !!email && email.toLowerCase().endsWith(`@${SCHOOL_DOMAIN}`);
}
