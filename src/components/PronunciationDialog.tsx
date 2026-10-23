import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeKey, upsertPronunciation, validatePronunciation } from "../lib/speech.ts";
import type { Pronunciation } from "../lib/speech.ts";

type Props = {
  rules: Pronunciation[];
  onChange: (rules: Pronunciation[]) => void;
  /** Bir okunuşu seslendirir (kuralı kulakla denemek için). */
  onPreview: (text: string) => void;
  canPreview: boolean;
  onClose: () => void;
};

const EMPTY = { from: "", to: "", wholeWord: true, matchCase: false };
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Bu sayıdan fazla kural varsa arama kutusu görünür. */
const SEARCH_FROM = 8;

export default function PronunciationDialog({ rules, onChange, onPreview, canPreview, onClose }: Props) {
  const [draft, setDraft] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const fromRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setError("");
  };

  const save = () => {
    const problem = validatePronunciation(draft.from, draft.to, rules, editingId);
    if (problem) {
      setError(problem);
      return;
    }
    const rule: Pronunciation = {
      id: editingId ?? uid(),
      from: normalizeKey(draft.from),
      to: draft.to.trim(),
      wholeWord: draft.wholeWord,
      matchCase: draft.matchCase
    };
    onChange(upsertPronunciation(rules, rule));
    reset();
    fromRef.current?.focus(); // peş peşe kural eklemek kolay olsun
  };

  const edit = (rule: Pronunciation) => {
    setDraft({ from: rule.from, to: rule.to, wholeWord: rule.wholeWord, matchCase: rule.matchCase });
    setEditingId(rule.id);
    setError("");
    formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    fromRef.current?.focus();
  };

  const remove = (rule: Pronunciation) => {
    onChange(rules.filter((r) => r.id !== rule.id));
    if (editingId === rule.id) reset();
  };

  // En son eklenen en üstte görünür; ekleyince kural hemen formun altında belirir.
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const list = [...rules].reverse();
    return q ? list.filter((r) => r.from.toLocaleLowerCase("tr").includes(q) || r.to.toLocaleLowerCase("tr").includes(q)) : list;
  }, [rules, query]);

  const setField = (patch: Partial<typeof EMPTY>) => {
    setError("");
    setDraft((d) => ({ ...d, ...patch }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal dict-modal" role="dialog" aria-modal="true" aria-labelledby="dict-title">
        <div className="dict-head">
          <h3 id="dict-title">Telaffuz sözlüğü</h3>
          <button type="button" className="text-button" onClick={onClose}>Kapat ×</button>
        </div>

        <div className="dict-body">
        <form ref={formRef} className="dict-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="field-label" htmlFor="dict-from">{editingId ? "Kuralı düzenle — metindeki yazılışı" : "Metindeki yazılışı"}</label>
          <input id="dict-from" ref={fromRef} className="text-input" value={draft.from} placeholder="ör. hale" maxLength={80} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setField({ from: e.target.value })} />
          <label className="field-label spaced" htmlFor="dict-to">Okunuşu</label>
          <input id="dict-to" className="text-input" value={draft.to} placeholder="ör. hâle" maxLength={200} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setField({ to: e.target.value })} />
          <label className="check-row"><input type="checkbox" checked={draft.wholeWord} onChange={(e) => setField({ wholeWord: e.target.checked })} /><span>Tam kelime olarak eşleş</span></label>
          <label className="check-row"><input type="checkbox" checked={draft.matchCase} onChange={(e) => setField({ matchCase: e.target.checked })} /><span>Büyük/küçük harfi ayırt et</span></label>
          <small className="field-hint">Tam kelime açıkken “NASA’nın” gibi kesme işaretli ekler de eşleşir; “haline” gibi ekli biçimler ayrı kural ister. Okunuşu boş bırakırsan kelime okunmaz.</small>
          <small className="field-hint">Yazılış ile okunuş aynıysa kural bir <b>istisna</b> olur: daha kısa bir kuralın o ifadeyi değiştirmesini engeller (ör. “hale getir” → “hale getir”, “hale” → “hâle” kuralından önce eşleşir).</small>
          {error && <div className="voice-warning" role="alert">{error}</div>}
          <div className="dict-actions">
            <button type="submit" className="secondary-button">{editingId ? "Kuralı güncelle" : "Kural ekle"}</button>
            {editingId && <button type="button" className="text-button" onClick={reset}>Vazgeç</button>}
          </div>
        </form>

        <div className="dict-count">{rules.length ? `${rules.length} kural` : "Henüz kural yok"}</div>
        {rules.length > SEARCH_FROM && (
          <input className="text-input dict-search" type="search" value={query} placeholder="Kurallarda ara" aria-label="Kurallarda ara" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        )}
        {rules.length === 0 && <p className="dict-empty">Eklediğin kurallar burada birikir. Örnek: <b>TBMM</b> → te be em em</p>}
        {rules.length > 0 && shown.length === 0 && <p className="dict-empty">Aramayla eşleşen kural yok.</p>}
        {shown.length > 0 && (
          <ul className="dict-list">
            {shown.map((rule) => (
              <li key={rule.id} className={editingId === rule.id ? "editing" : undefined}>
                <div className="dict-pair">
                  <span><b>{rule.from}</b> → {rule.to || "(okunmaz)"}</span>
                  {(!rule.wholeWord || rule.matchCase || rule.from === rule.to) && (
                    <small>{[rule.from === rule.to && "istisna", !rule.wholeWord && "kelime içinde de", rule.matchCase && "harf duyarlı"].filter(Boolean).join(", ")}</small>
                  )}
                </div>
                <div className="dict-row-actions">
                  <button type="button" className="text-button" aria-label={`“${rule.from}” okunuşunu dinle`} disabled={!canPreview || !rule.to} onClick={() => onPreview(rule.to)}>Dinle</button>
                  <button type="button" className="text-button" aria-label={`“${rule.from}” kuralını düzenle`} onClick={() => edit(rule)}>Düzenle</button>
                  <button type="button" className="danger-text" aria-label={`“${rule.from}” kuralını sil`} onClick={() => remove(rule)}>Sil</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}
