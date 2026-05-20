import { redirect } from 'next/navigation'

// Auth is disabled — anyone landing on /login goes straight to the dashboard.
export default function LoginPage() {
  redirect('/')
}
