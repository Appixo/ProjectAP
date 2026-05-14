export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = process.env.ALLOWED_EMAIL
  if (!allowed) return false
  return email.trim().toLowerCase() === allowed.trim().toLowerCase()
}
