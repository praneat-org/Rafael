import { type ErrorText, errorText } from '../../src/error-text';

/** what happened + what to do. The raw code is only a small muted tail for support (code only, D11). */
export function ErrorNote({ code, text }: { code?: string; text?: ErrorText }) {
  const t = text ?? errorText(code ?? '');
  return (
    <div className="note err" role="alert">
      <p className="err-what">{t.what}</p>
      <p className="err-todo">{t.todo}</p>
      {code && <p className="err-code">รหัส: {code}</p>}
    </div>
  );
}
