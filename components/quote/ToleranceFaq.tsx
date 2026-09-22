import { FAQS } from '@/lib/content';

/**
 * details/summary, no JS — it sits beside the form to kill the last objection
 * before the upload. Handoff §09.8 wants this published as its own indexable
 * page too; the copy already lives in lib/content so both can share it.
 */
export default function ToleranceFaq() {
  return (
    <div className="border border-white/10 bg-panel p-[clamp(22px,3vw,30px)]">
      <div className="mb-[18px] font-mono text-[10px] uppercase tracking-[.24em] text-ember">
        Tolerance FAQ
      </div>
      {FAQS.map((faq, i) => (
        <details
          key={faq.q}
          className={`py-3 ${i < FAQS.length - 1 ? 'border-b border-hairline' : ''}`}
        >
          <summary className="faq-summary cursor-pointer list-none font-display text-[15px] font-semibold text-ink">
            {faq.q}
          </summary>
          <p className="mt-2.5 text-[13.5px] leading-[1.6] text-body">{faq.a}</p>
        </details>
      ))}
    </div>
  );
}
