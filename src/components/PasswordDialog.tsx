import { useEffect, useRef, useState } from "react";

type Props = {
  wasIncorrect: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

export default function PasswordDialog({ wasIncorrect, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pw-title">
        <h3 id="pw-title">Bu PDF parola korumalı</h3>
        <p>{wasIncorrect ? "Parola yanlış. Tekrar dene." : "Metni çıkarabilmek için PDF'in parolasını gir. Parola cihazdan çıkmaz ve saklanmaz."}</p>
        <input
          ref={inputRef}
          type="password"
          className="modal-input"
          value={value}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value) onSubmit(value); }}
          aria-label="PDF parolası"
        />
        <div className="modal-actions">
          <button className="text-button" onClick={onCancel}>Vazgeç</button>
          <button className="secondary-button" disabled={!value} onClick={() => onSubmit(value)}>Aç</button>
        </div>
      </div>
    </div>
  );
}
