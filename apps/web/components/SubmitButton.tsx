'use client';
/** Form submit button that shows a pending state while a server action runs. */
import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  pendingText = 'Working…',
}: {
  children: React.ReactNode;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}
