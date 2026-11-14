'use client';
/** Opens the browser print dialog ("Save as PDF" produces the PDF report). */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
