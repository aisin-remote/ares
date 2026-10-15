import { redirect } from 'next/navigation';
import { getDisplaySession } from '@/lib/session';
import { DisplaySetupForm } from './setup-form';

export default async function DisplaySetupPage() {
  if (await getDisplaySession()) redirect('/display/receiving');
  return <DisplaySetupForm />;
}
