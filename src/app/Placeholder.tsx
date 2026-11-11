import { t, type StringKey } from '../i18n';

export function Placeholder({ title, body }: { title: StringKey; body?: StringKey }) {
  return (
    <section>
      <h2>{t(title)}</h2>
      {body && <p>{t(body)}</p>}
    </section>
  );
}
