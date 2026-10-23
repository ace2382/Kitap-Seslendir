import { useEffect } from "react";

export type PauseField = {
  id: string;
  label: string;
  hint?: string;
  value: number;
  set: (value: number) => void;
  max: number;
  step: number;
  group: "Noktalama" | "Yapı";
};

type Props = {
  fields: PauseField[];
  /** Ses motoru hazır mı (örnek okuma düğmesi için). */
  canTry: boolean;
  /** Şu anki ayarlarla kısa bir örnek okur. */
  onTry: () => void;
  onReset: () => void;
  onClose: () => void;
};

export const formatSeconds = (n: number) => (n <= 0 ? "Yok" : `${n.toFixed(2).replace(/0$/, "").replace(".", ",")} sn`);

const GROUPS: PauseField["group"][] = ["Noktalama", "Yapı"];
const GROUP_TITLE: Record<PauseField["group"], string> = {
  Noktalama: "Noktalama işaretlerinden sonra",
  Yapı: "Paragraf ve başlıklar"
};

export default function PauseDialog({ fields, canTry, onTry, onReset, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal dict-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <div className="dict-head">
          <h3 id="pause-title">Duraklamalar</h3>
          <button type="button" className="text-button" onClick={onClose}>Kapat ×</button>
        </div>

        <div className="dict-body">
          <p className="dialog-lead">
            Süreler ses motorunun kendi doğal beklemesinin üstüne eklenir ve konuşma hızından etkilenmez. “Yok” seçilen işaretlerde
            motor kendi bildiği gibi okur. Açık olan her işaret, metni daha çok parçaya böler; ses dosyası oluşturma biraz uzar.
          </p>
          {GROUPS.map((group) => (
            <section key={group} className="dialog-group">
              <h4>{GROUP_TITLE[group]}</h4>
              {fields.filter((f) => f.group === group).map((f, i) => (
                <div key={f.id} className={i === 0 ? "range-field flush" : "range-field"}>
                  <div>
                    <label htmlFor={f.id}>{f.label}</label>
                    <output>{formatSeconds(f.value)}</output>
                  </div>
                  <input id={f.id} type="range" min="0" max={f.max} step={f.step} value={f.value} onChange={(e) => f.set(Number(e.target.value))} />
                  {f.hint && <small className="field-hint">{f.hint}</small>}
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="dict-foot">
          <button type="button" className="secondary-button" disabled={!canTry} onClick={onTry}>▶ Dene</button>
          <button type="button" className="text-button" onClick={onReset}>Varsayılana dön</button>
        </div>
      </div>
    </div>
  );
}
