import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // Akun supplier punya VENDOR_ID; layar internal tidak relevan baginya.
  redirect(user.vendorId != null ? '/portal' : '/dashboard');
}
