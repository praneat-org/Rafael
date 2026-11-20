import guide from '../../../docs/onboarding.md?raw';
import { mdToHtml } from '../../extension/src/pdf';

// docs/onboarding.md is the one source (GitHub + this page). mdToHtml escapes everything it renders.
const html = mdToHtml(guide);

export function Onboarding() {
  return (
    <main className="view onboarding">
      <a className="link" href="#/">
        ← กลับ
      </a>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own bundled markdown, escaped by mdToHtml */}
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
