import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

export function AuthBrandPanel() {
  const t = useTranslations("auth.brand");
  const year = new Date().getFullYear();

  const features = [
    t("feature1"),
    t("feature2"),
    t("feature3"),
    t("feature4"),
  ];

  return (
    <div className="relative hidden overflow-hidden bg-[#060810] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#1D9E75]/25 blur-[120px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[140px]" />
      <div className="pointer-events-none absolute -right-24 top-1/3 h-[420px] w-[420px] rounded-full bg-[#1D9E75]/15 blur-[130px]" />

      <div className="relative z-10 flex flex-col gap-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1D9E75]">
            <MessageSquare className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">Funilly</span>
        </div>

        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center rounded-full border border-[#1D9E75]/30 bg-[#1D9E75]/10 px-3 py-1 text-xs font-medium text-[#5DCAA5]">
            {t("tag")}
          </span>

          <h1 className="max-w-md text-4xl leading-tight font-semibold text-white xl:text-[2.75rem]">
            {t("titleStart")}{" "}
            <span className="text-[#1D9E75]">{t("titleHighlight")}</span>{" "}
            {t("titleEnd")}
          </h1>

          <p className="max-w-sm text-base leading-relaxed text-white/35">
            {t("subtitle")}
          </p>
        </div>

        <ul className="flex flex-col gap-4">
          {features.map((feature) => (
            <li key={feature} className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1D9E75]" />
              <span className="text-sm text-white/35">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 flex flex-col gap-8">
        <div className="flex items-center gap-8 border-t border-white/6 pt-8">
          <Stat value={t("statDeliveryValue")} label={t("statDeliveryLabel")} />
          <Stat
            value={t("statConversionValue")}
            label={t("statConversionLabel")}
          />
          <Stat value={t("statTeamsValue")} label={t("statTeamsLabel")} />
        </div>
        <p className="text-xs text-white/20">{t("footer", { year })}</p>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xl font-semibold text-white">{value}</span>
      <span className="text-xs text-white/35">{label}</span>
    </div>
  );
}
